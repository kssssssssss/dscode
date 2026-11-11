import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildTaskSteps,
  collectTaskPlans,
  formatStepDuration,
  mergeTaskPlans,
  planPreviewLines,
  proposedPlanLabel,
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

describe("collectTaskPlans", () => {
  it("uses the latest todo list and reports the running step", () => {
    const plan = collectTaskPlans({
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
    expect(plan.todo).toEqual({
      kind: "todo_list",
      id: "current",
      sequence: 2_000_002,
      completed: 1,
      total: 3,
      runningText: "Write the board",
      explanation: null,
      steps: [
        { id: "a", text: "Read the diff", status: "completed", durationMs: 1500 },
        { id: "b", text: "Write the board", status: "running", durationMs: null },
        { id: "c", text: "Open the thread", status: "pending", durationMs: null },
      ],
    });
    expect(plan.previous.map((version) => version.id)).toEqual(["stale", "old"]);
  });

  it("shows an active proposed plan when the thread has no current todo list", () => {
    expect(
      collectTaskPlans({
        runs: [],
        plans: [
          { id: "old", kind: "proposed_plan", status: "superseded", runId: null, markdown: "Old" },
          {
            id: "plan",
            kind: "proposed_plan",
            status: "active",
            runId: "run-1",
            markdown: "# Ship it\n\nDo the thing.",
          },
        ],
      }),
    ).toMatchObject({
      todo: null,
      proposed: { id: "plan", markdown: "# Ship it\n\nDo the thing.", stripped: false },
      previous: [{ id: "old", markdown: "Old" }],
    });
    expect(proposedPlanLabel("active")).toBe("Plan awaiting approval");
    expect(proposedPlanLabel("draft")).toBe("Draft plan");
  });

  it("keeps the proposed plan beside the latest todo list", () => {
    const plan = collectTaskPlans({
      runs: [],
      plans: [
        { id: "plan", kind: "proposed_plan", status: "active", runId: null, markdown: "Keep me" },
        todo("list", "active", null, [{ id: "a", text: "Ship it", status: "pending" }]),
      ],
    });
    expect(plan.todo?.id).toBe("list");
    expect(plan.proposed?.markdown).toBe("Keep me");
    expect(plan.previous).toEqual([]);
  });

  it("keeps a todo explanation and lists superseded plans newest first", () => {
    const plan = collectTaskPlans({
      runs: [{ id: "run-1", ordinal: 1 }],
      plans: [
        {
          id: "first",
          kind: "todo_list",
          status: "superseded",
          runId: "run-1",
          explanation: "Started here",
          steps: [{ id: "a", text: "Old step", status: "completed" }],
        },
        {
          id: "second",
          kind: "todo_list",
          status: "active",
          runId: "run-1",
          explanation: "  Why this list  ",
          steps: [{ id: "b", text: "New step", status: "pending" }],
        },
      ],
    });
    expect(plan.todo?.explanation).toBe("Why this list");
    expect(plan.previous.map((version) => version.id)).toEqual(["first"]);
    expect(plan.previous[0]?.explanation).toBe("Started here");
  });

  it("fills a trimmed plan body from the full snapshot", () => {
    const live = collectTaskPlans({
      runs: [],
      plans: [
        {
          id: "old",
          kind: "proposed_plan",
          status: "superseded",
          runId: null,
          markdown: "",
          detailInTurnItem: true,
        },
        { id: "plan", kind: "proposed_plan", status: "active", runId: null, markdown: "# Now" },
      ],
    });
    const full = collectTaskPlans({
      runs: [],
      plans: [
        { id: "old", kind: "proposed_plan", status: "superseded", runId: null, markdown: "# Then" },
        { id: "plan", kind: "proposed_plan", status: "active", runId: null, markdown: "# Now" },
      ],
    });
    expect(live.previous[0]?.stripped).toBe(true);
    expect(mergeTaskPlans(live, full)?.previous[0]?.markdown).toBe("# Then");
  });

  it("keeps the shell's proposed-plan flag until a snapshot arrives", () => {
    expect(taskPlanForCard(undefined, true)).toEqual({
      todo: null,
      proposed: {
        kind: "proposed_plan",
        id: "",
        sequence: -1,
        status: "active",
        markdown: "",
        stripped: false,
      },
      previous: [],
    });
    expect(taskPlanForCard(null, true)).toBeNull();
    expect(taskPlanForCard(undefined, false)).toBeNull();
  });
});

describe("planPreviewLines", () => {
  it("keeps the first visible lines of a proposed plan", () => {
    expect(planPreviewLines("# Title\n\nFirst\n\nSecond\nThird\nFourth", 3)).toEqual([
      "First",
      "Second",
      "Third",
    ]);
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
        collectTaskPlans({
          runs: [],
          plans: [
            todo("list", "active", null, [
              { id: "a", text: "Pending step", status: "pending" },
              { id: "b", text: "Done step", status: "completed", durationMs: 2000 },
            ]),
          ],
        }),
      ],
      [
        "primary:other",
        collectTaskPlans({
          runs: [],
          plans: [{ id: "plan", kind: "proposed_plan", status: "active", runId: null }],
        }),
      ],
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
        threadKey: "primary:thread-1",
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
        threadKey: "primary:thread-1",
        environmentId: "primary",
        threadId: "thread-1",
      },
    ]);
  });
});
