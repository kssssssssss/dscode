import { describe, expect, it } from "vite-plus/test";

import {
  compareTaskProgressPercent,
  countTaskStepProgress,
  describeTaskStepProgress,
  sumTaskStepProgress,
  taskStepBlockReason,
  taskThreadStepProgress,
  type TaskStepThreadSignal,
} from "./taskProgress";

const step = (status: "pending" | "running" | "completed") => ({ status });

function signal(overrides: Partial<TaskStepThreadSignal> = {}): TaskStepThreadSignal {
  return {
    activityStatus: "Idle",
    latestRunStatus: null,
    awaitingPlan: false,
    ...overrides,
  };
}

const mixed = [step("completed"), step("completed"), step("running"), step("pending")];

describe("taskStepBlockReason", () => {
  it("keeps an active run's own step statuses", () => {
    for (const activityStatus of ["Working", "Connecting", "Waiting"]) {
      expect(
        taskStepBlockReason(
          signal({ activityStatus, awaitingPlan: true, latestRunStatus: "failed" }),
        ),
      ).toBeNull();
    }
  });

  it("blocks while the thread is waiting on a person", () => {
    expect(taskStepBlockReason(signal({ activityStatus: "Pending Approval" }))).toBe(
      "Waiting for approval",
    );
    expect(taskStepBlockReason(signal({ activityStatus: "Awaiting Input" }))).toBe(
      "Waiting for your input",
    );
    expect(taskStepBlockReason(signal({ activityStatus: "Guest Request" }))).toBe(
      "Waiting on a guest",
    );
    expect(taskStepBlockReason(signal({ activityStatus: "Plan Ready" }))).toBe(
      "Plan awaiting approval",
    );
    expect(
      taskStepBlockReason(
        signal({ activityStatus: "Idle", latestRunStatus: "completed", awaitingPlan: true }),
      ),
    ).toBe("Plan awaiting approval");
  });

  it("blocks a failed, interrupted, or otherwise stopped run, including one the pill no longer shows", () => {
    expect(taskStepBlockReason(signal({ activityStatus: "Failed" }))).toBe("The run failed");
    expect(taskStepBlockReason(signal({ activityStatus: "Idle", latestRunStatus: "failed" }))).toBe(
      "The run failed",
    );
    expect(
      taskStepBlockReason(signal({ activityStatus: "Idle", latestRunStatus: "interrupted" })),
    ).toBe("The run was interrupted");
    expect(
      taskStepBlockReason(signal({ activityStatus: "Idle", latestRunStatus: "cancelled" })),
    ).toBe("The run was cancelled");
    expect(
      taskStepBlockReason(signal({ activityStatus: "Idle", latestRunStatus: "rolled_back" })),
    ).toBe("The run was rolled back");
    expect(taskStepBlockReason(signal({ activityStatus: "Usage limit" }))).toBe("Usage limit");
    expect(taskStepBlockReason(signal({ activityStatus: "Snoozed" }))).toBe("Snoozed");
    expect(
      taskStepBlockReason(signal({ activityStatus: "Completed", latestRunStatus: "completed" })),
    ).toBe("Stopped with steps unfinished");
    expect(taskStepBlockReason(signal())).toBe("Stopped with steps unfinished");
  });
});

describe("countTaskStepProgress", () => {
  it("counts pending, running, and completed while the thread is still working", () => {
    expect(countTaskStepProgress(mixed, null)).toEqual({
      planned: 4,
      completed: 2,
      running: 1,
      pending: 1,
      blocked: 0,
      percent: 50,
    });
  });

  it("counts every unfinished step as blocked, including one that was running", () => {
    expect(countTaskStepProgress(mixed, "The run was interrupted")).toEqual({
      planned: 4,
      completed: 2,
      running: 0,
      pending: 0,
      blocked: 2,
      percent: 50,
    });
  });

  it("rounds the percent and leaves an empty list without one", () => {
    expect(
      countTaskStepProgress([step("completed"), step("pending"), step("pending")], null),
    ).toMatchObject({
      percent: 33,
    });
    expect(countTaskStepProgress([], "Stopped with steps unfinished")).toEqual({
      planned: 0,
      completed: 0,
      running: 0,
      pending: 0,
      blocked: 0,
      percent: null,
    });
  });

  it("sums step counts across threads, not their percents", () => {
    const half = countTaskStepProgress([step("completed"), step("pending")], null);
    const none = countTaskStepProgress([step("pending"), step("pending")], null);
    expect(sumTaskStepProgress([half, none])).toMatchObject({
      planned: 4,
      completed: 1,
      pending: 3,
      percent: 25,
    });
    expect(sumTaskStepProgress([])).toMatchObject({ planned: 0, percent: null });
  });
});

describe("taskThreadStepProgress", () => {
  const todo = {
    steps: [step("completed"), step("running"), step("pending")],
  };

  it("uses an active proposed plan as the block reason once the run has stopped", () => {
    expect(
      taskThreadStepProgress(
        { activityStatus: "Idle", latestRunStatus: "completed" },
        { proposed: { status: "active" }, todo },
      ),
    ).toEqual({
      blockedReason: "Plan awaiting approval",
      progress: {
        planned: 3,
        completed: 1,
        running: 0,
        pending: 0,
        blocked: 2,
        percent: 33,
      },
    });
  });

  it("leaves a working thread's steps alone even when a proposal is still active", () => {
    const result = taskThreadStepProgress(
      { activityStatus: "Working", latestRunStatus: "running" },
      { proposed: { status: "active" }, todo },
    );
    expect(result.blockedReason).toBeNull();
    expect(result.progress).toMatchObject({ running: 1, pending: 1, blocked: 0, percent: 33 });
  });

  it("prefers a failed run over a proposal that is still active", () => {
    expect(
      taskThreadStepProgress(
        { activityStatus: "Idle", latestRunStatus: "failed" },
        { proposed: { status: "active" }, todo },
      ).blockedReason,
    ).toBe("The run failed");
  });

  it("drops the reason when every step is already complete", () => {
    const result = taskThreadStepProgress(
      { activityStatus: "Idle", latestRunStatus: "interrupted" },
      { proposed: null, todo: { steps: [step("completed")] } },
    );
    expect(result.blockedReason).toBeNull();
    expect(result.progress).toMatchObject({ planned: 1, completed: 1, blocked: 0, percent: 100 });
  });

  it("describes the counts and the blocked reason together", () => {
    const result = taskThreadStepProgress(
      { activityStatus: "Awaiting Input", latestRunStatus: "waiting" },
      { proposed: null, todo },
    );
    expect(describeTaskStepProgress(result.progress, result.blockedReason)).toBe(
      "1 of 3 steps complete, 33 percent. 0 running, 0 pending, 2 blocked. Blocked: Waiting for your input.",
    );
  });
});

describe("compareTaskProgressPercent", () => {
  const row = (title: string, percent: number | null) => ({ title, percent });

  it("sorts by percent and keeps threads with no list at the bottom", () => {
    const rows = [row("Bee", 50), row("Aye", null), row("Cee", 50), row("Dee", 10)];
    expect(
      rows
        .toSorted((left, right) => compareTaskProgressPercent(left, right, "desc"))
        .map((entry) => entry.title),
    ).toEqual(["Bee", "Cee", "Dee", "Aye"]);
    expect(
      rows
        .toSorted((left, right) => compareTaskProgressPercent(left, right, "asc"))
        .map((entry) => entry.title),
    ).toEqual(["Dee", "Bee", "Cee", "Aye"]);
  });
});
