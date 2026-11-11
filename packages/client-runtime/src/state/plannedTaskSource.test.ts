import { EnvironmentId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { describe, expect, it } from "vite-plus/test";

import {
  choosePlannedTaskAttempt,
  describePlannedTaskFailure,
  planPlannedTaskRead,
  type PlannedTaskReaderCandidate,
} from "./plannedTaskSource.ts";

const desktop = EnvironmentId.make("desktop");
const dev = EnvironmentId.make("dev");

function environment(
  environmentId: EnvironmentId,
  options: {
    label?: string;
    displayUrl?: string | null;
    plannedTasks?: boolean;
    os?: "darwin" | "linux" | "windows";
    phase?: string;
    primary?: boolean;
    config?: boolean;
  } = {},
): PlannedTaskReaderCandidate {
  return {
    environmentId,
    label: options.label ?? (environmentId === dev ? "Local" : "Desktop"),
    displayUrl:
      options.displayUrl === undefined
        ? environmentId === dev
          ? "http://127.0.0.1:13773/"
          : "http://127.0.0.1:3773/"
        : options.displayUrl,
    connection: { phase: options.phase ?? "connected" },
    primary: options.primary ?? environmentId === dev,
    serverConfig:
      options.config === false
        ? null
        : {
            environment: {
              platform: { os: options.os ?? "windows", arch: "x64" },
              capabilities: {
                repositoryIdentity: true,
                ...(options.plannedTasks ? { plannedTasks: true } : {}),
              },
            },
          },
  };
}

describe("planPlannedTaskRead", () => {
  it("reads from the project server when that server serves planned tasks", () => {
    const plan = planPlannedTaskRead({
      projectName: "病案",
      owner: desktop,
      environments: [
        environment(desktop, { plannedTasks: true, primary: false }),
        environment(dev, { plannedTasks: true }),
      ],
    });
    expect(plan.waiting).toBe(false);
    expect(plan.unavailableReason).toBeNull();
    expect(plan.attempts.map((attempt) => attempt.environmentId)).toEqual([desktop, dev]);
    expect(plan.attempts[0]?.note).toBe("病案: Read by Desktop (127.0.0.1:3773).");
  });

  it("asks the local primary when the project server is an older install on the same machine", () => {
    const plan = planPlannedTaskRead({
      projectName: "病案",
      owner: desktop,
      environments: [
        environment(desktop, { primary: false }),
        environment(dev, { plannedTasks: true, displayUrl: "http://localhost:13773/" }),
      ],
    });
    expect(plan.attempts.map((attempt) => attempt.environmentId)).toEqual([dev]);
    expect(plan.attempts[0]?.note).toBe(
      "病案: Read by Local (localhost:13773). Desktop (127.0.0.1:3773) does not serve planned tasks.",
    );
  });

  it("waits while either server's version is still unknown", () => {
    expect(
      planPlannedTaskRead({
        projectName: "病案",
        owner: desktop,
        environments: [
          environment(desktop, { primary: false, config: false }),
          environment(dev, { plannedTasks: true }),
        ],
      }).waiting,
    ).toBe(true);
    expect(
      planPlannedTaskRead({
        projectName: "病案",
        owner: desktop,
        environments: [
          environment(desktop, { primary: false }),
          environment(dev, { plannedTasks: true, config: false, phase: "connecting" }),
        ],
      }).waiting,
    ).toBe(true);
  });

  it("explains when the local server is not on the same machine", () => {
    const remote = planPlannedTaskRead({
      projectName: "病案",
      owner: desktop,
      environments: [
        environment(desktop, { primary: false, displayUrl: "http://100.64.0.8:3773/" }),
        environment(dev, { plannedTasks: true }),
      ],
    });
    expect(remote.attempts).toEqual([]);
    expect(remote.unavailableReason).toContain("not on the same machine");

    const otherOs = planPlannedTaskRead({
      projectName: "病案",
      owner: desktop,
      environments: [
        environment(desktop, { primary: false, os: "windows" }),
        environment(dev, { plannedTasks: true, os: "linux" }),
      ],
    });
    expect(otherOs.unavailableReason).toContain("different system");

    const relay = planPlannedTaskRead({
      projectName: "病案",
      owner: desktop,
      environments: [
        environment(desktop, { primary: false }),
        environment(dev, { plannedTasks: true, displayUrl: null }),
      ],
    });
    expect(relay.unavailableReason).toContain("not on the same machine");
  });

  it("explains when no connected local server can read the files", () => {
    expect(
      planPlannedTaskRead({
        projectName: "病案",
        owner: desktop,
        environments: [
          environment(desktop, { primary: false }),
          environment(dev, { plannedTasks: true, phase: "disconnected" }),
        ],
      }).unavailableReason,
    ).toContain("is not connected");
    expect(
      planPlannedTaskRead({
        projectName: "病案",
        owner: desktop,
        environments: [environment(desktop, { primary: false }), environment(dev)],
      }).unavailableReason,
    ).toContain("neither");
    expect(
      planPlannedTaskRead({
        projectName: "病案",
        owner: dev,
        environments: [environment(dev)],
      }).unavailableReason,
    ).toBe("病案: Local (127.0.0.1:13773) does not serve planned tasks.");
  });
});

describe("choosePlannedTaskAttempt", () => {
  it("uses the next server only after an unknown method", () => {
    expect(
      choosePlannedTaskAttempt([
        { _tag: "Failure", described: { unsupported: true, detail: "missing" } },
        { _tag: "Success" },
      ]),
    ).toEqual({ _tag: "success", index: 1 });
    expect(
      choosePlannedTaskAttempt([
        {
          _tag: "Failure",
          described: { unsupported: false, detail: "That folder is not on this machine: D:\\病案" },
        },
        { _tag: "Success" },
      ]),
    ).toEqual({
      _tag: "failure",
      index: 0,
      detail: "That folder is not on this machine: D:\\病案",
    });
    expect(choosePlannedTaskAttempt([{ _tag: "Pending" }, { _tag: "Success" }])).toEqual({
      _tag: "pending",
    });
  });
});

describe("describePlannedTaskFailure", () => {
  it("recognizes an unknown request tag and a path refusal", () => {
    expect(
      describePlannedTaskFailure(
        Cause.die(new Error("Unknown request tag: plannedTasks.subscribe")),
      ).unsupported,
    ).toBe(true);
    const refused = describePlannedTaskFailure(
      Cause.fail({ detail: "That folder is not on this machine: D:\\病案" }),
    );
    expect(refused.unsupported).toBe(false);
    expect(refused.detail).toContain("not on this machine");
  });
});
