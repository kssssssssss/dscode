import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildTaskSteps,
  formatStepDuration,
  proposedPlanLabel,
  selectTaskPlan,
  taskPlanForCard,
  type TaskPlanSource,
  type TaskPlanSourceStep,
} from "./taskPlanSummary";

function todo(
  id: string,
  status: TaskPlanSource["status"],
  runId: string | null,
  steps: readonly TaskPlanSourceStep[],
): TaskPlanSource {
  return { id, kind: "todo_list", status, runId, steps };
}

describe("selectTaskPlan", () => {
  it("uses the latest todo list and reports the running step", () => {
    const plan = selectTaskPlan({
      runs: [
        { id: "run-1", ordinal: 1 },
        { id: "run-2", ordinal: 2 },
      ],
      plans: [
        todo("old", "active", "run-1", [{ id: "a", text: "First", status: "completed" }]),
        todo("stale", "superseded", "run-2", [{ id: "z", text: "Gone", status: "pending" }]),
        todo("current", "active", "run-2", [
          { id: "a", text: "Read the diff", status: "completed", durationMs: 1500 },
          { id: "b", text: "Write the board", status: "running" },
          { id: "c", text: "Open the thread", status: "pending" },
        ]),
      ],
    });
    expect(plan).toEqual({
      kind: "todo_list",
      completed: 1,
      total: 3,
      runningText: "Write the board",
      steps: [
        { id: "a", text: "Read the diff", status: "completed", durationMs: 1500 },
        { id: "b", text: "Write the board", status: "running", durationMs: null },
        { id: "c", text: "Open the thread", status: "pending", durationMs: null },
      ],
    });
  });

  it("shows an active proposed plan when the thread has no current todo list", () => {
    expect(
      selectTaskPlan({
        runs: [],
        plans: [
          { id: "old", kind: "proposed_plan", status: "superseded", runId: null },
          { id: "plan", kind: "proposed_plan", status: "active", runId: "run-1" },
        ],
      }),
    ).toEqual({ kind: "proposed_plan", status: "active" });
    expect(proposedPlanLabel("active")).toBe("Plan awaiting approval");
    expect(proposedPlanLabel("draft")).toBe("Draft plan");
  });

  it("prefers a todo list over a proposed plan", () => {
    const plan = selectTaskPlan({
      runs: [],
      plans: [
        { id: "plan", kind: "proposed_plan", status: "active", runId: null },
        todo("list", "active", null, [{ id: "a", text: "Ship it", status: "pending" }]),
      ],
    });
    expect(plan?.kind).toBe("todo_list");
  });

  it("keeps the shell's proposed-plan flag until a snapshot arrives", () => {
    expect(taskPlanForCard(undefined, true)).toEqual({
      kind: "proposed_plan",
      status: "active",
    });
    expect(taskPlanForCard(null, true)).toBeNull();
    expect(taskPlanForCard(undefined, false)).toBeNull();
  });
});

describe("formatStepDuration", () => {
  it("formats milliseconds, seconds, and minutes", () => {
    expect(formatStepDuration(40)).toBe("40ms");
    expect(formatStepDuration(1500)).toBe("1.5s");
    expect(formatStepDuration(12_000)).toBe("12s");
    expect(formatStepDuration(125_000)).toBe("2m 5s");
  });
});

describe("buildTaskSteps", () => {
  const card = {
    key: "primary:thread-1",
    environmentId: EnvironmentId.make("primary"),
    threadId: ThreadId.make("thread-1"),
    projectName: "DS Code",
    projectKey: "project",
    title: "Review the board",
  };

  it("turns todo steps into cards and skips threads without a list", () => {
    const plans = new Map([
      [
        card.key,
        selectTaskPlan({
          runs: [],
          plans: [
            todo("list", "active", null, [
              { id: "a", text: "Pending step", status: "pending" },
              { id: "b", text: "Done step", status: "completed", durationMs: 2000 },
            ]),
          ],
        }),
      ],
      ["primary:other", { kind: "proposed_plan" as const, status: "active" as const }],
    ]);
    expect(buildTaskSteps([card], plans)).toEqual([
      {
        key: "primary:thread-1\u0000a",
        column: "pending",
        text: "Pending step",
        durationMs: null,
        projectName: "DS Code",
        projectKey: "project",
        threadTitle: "Review the board",
        environmentId: "primary",
        threadId: "thread-1",
      },
      {
        key: "primary:thread-1\u0000b",
        column: "completed",
        text: "Done step",
        durationMs: 2000,
        projectName: "DS Code",
        projectKey: "project",
        threadTitle: "Review the board",
        environmentId: "primary",
        threadId: "thread-1",
      },
    ]);
  });
});
