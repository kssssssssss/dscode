import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ProjectId, ProviderInstanceId, RunId, ThreadId } from "@t3tools/contracts";

import { makeThreadFixture } from "../../test-fixtures";
import {
  buildTaskCards,
  countTaskColumns,
  dropTargetColumn,
  filterTaskCards,
  planTaskMove,
  type TaskCard,
} from "./taskBoard";

const local = EnvironmentId.make("local");
const NOW = "2026-10-20T12:00:00.000Z";
let nextThread = 0;

function thread(projectId: string, overrides: Parameters<typeof makeThreadFixture>[0] = {}) {
  nextThread += 1;
  return makeThreadFixture({
    id: ThreadId.make(`thread-${nextThread}`),
    environmentId: local,
    projectId: ProjectId.make(projectId),
    title: overrides.title ?? `Thread ${nextThread}`,
    updatedAt: "2026-10-20T10:00:00.000Z",
    ...overrides,
  });
}

const runtime = {
  status: "idle" as const,
  activeRunId: null,
  providerInstanceId: ProviderInstanceId.make("codex"),
  providerName: "Codex",
  lastError: null,
  updatedAt: "2026-10-20T10:00:00.000Z",
};

function completedRun(completedAt: string, status: "completed" | "failed" = "completed") {
  return {
    runId: RunId.make("run-1"),
    status,
    requestedAt: "2026-10-20T09:00:00.000Z",
    startedAt: "2026-10-20T09:00:00.000Z",
    completedAt,
    assistantMessageId: null,
  };
}

function board(
  threads: ReturnType<typeof thread>[],
  options: {
    placements?: Record<string, "todo" | "review" | "done">;
    projectKey?: string;
    canSettle?: boolean;
    canSnooze?: boolean;
  } = {},
) {
  return buildTaskCards({
    threads,
    groups: [
      {
        projectKey: "alpha",
        displayName: "Alpha",
        memberProjects: [{ environmentId: local, id: ProjectId.make("alpha") }],
      },
      {
        projectKey: "beta",
        displayName: "Beta",
        memberProjects: [{ environmentId: local, id: ProjectId.make("beta") }],
      },
    ],
    delegatedUnderParent: new Set(),
    placements: options.placements ?? {},
    now: NOW,
    capabilities: () => ({
      threadSettlement: options.canSettle ?? true,
      threadSnooze: options.canSnooze ?? true,
    }),
    ...(options.projectKey ? { projectKey: options.projectKey } : {}),
  });
}

function columnOf(cards: readonly TaskCard[], title: string) {
  return cards.find((card) => card.title === title);
}

describe("buildTaskCards", () => {
  it("maps thread state onto kanban columns and lets a resting card keep a manual column", () => {
    const idle = thread("alpha", { title: "Idle", runtime });
    const running = thread("alpha", {
      title: "Running",
      runtime: { ...runtime, status: "running" },
    });
    const waiting = thread("alpha", { title: "Question", hasPendingUserInput: true, runtime });
    const failed = thread("alpha", {
      title: "Failed",
      runtime,
      latestRun: completedRun("2026-10-20T11:00:00.000Z", "failed"),
    });
    const snoozed = thread("alpha", {
      title: "Snoozed",
      runtime,
      snoozedAt: "2026-10-20T08:00:00.000Z",
      snoozedUntil: "2026-10-21T08:00:00.000Z",
    });
    const settled = thread("alpha", { title: "Settled", runtime, settledOverride: "settled" });
    const reviewed = thread("alpha", {
      title: "Reviewed",
      runtime,
      latestRun: completedRun("2026-10-20T11:00:00.000Z"),
      lastVisitedAt: "2026-10-20T09:30:00.000Z",
    });
    const limited = thread("beta", {
      title: "Limited",
      runtime: {
        ...runtime,
        lastErrorClass: "usage_limit",
        usageLimitResetAt: "2026-10-21T00:00:00.000Z",
      },
    });
    const cards = board([idle, running, waiting, failed, snoozed, settled, reviewed, limited], {
      placements: { [`${local}:${idle.id}`]: "review" },
    });

    expect(columnOf(cards, "Idle")).toMatchObject({
      column: "review",
      derivedColumn: "todo",
      locked: false,
      statusLabel: "Needs review",
      projectName: "Alpha",
      provider: "Codex",
    });
    expect(columnOf(cards, "Running")).toMatchObject({
      column: "progress",
      locked: true,
      statusLabel: "Working",
    });
    expect(columnOf(cards, "Question")).toMatchObject({
      column: "review",
      locked: true,
      statusLabel: "Awaiting Input",
    });
    expect(columnOf(cards, "Failed")).toMatchObject({
      column: "blocked",
      locked: true,
      statusLabel: "Failed",
    });
    expect(columnOf(cards, "Snoozed")).toMatchObject({
      column: "blocked",
      locked: false,
      snoozed: true,
      statusLabel: "Snoozed",
    });
    expect(columnOf(cards, "Settled")).toMatchObject({
      column: "done",
      locked: false,
      statusLabel: "Settled",
    });
    expect(columnOf(cards, "Reviewed")).toMatchObject({
      column: "review",
      locked: false,
      statusLabel: "Completed",
    });
    expect(columnOf(cards, "Limited")).toMatchObject({
      column: "blocked",
      locked: true,
      projectName: "Beta",
      statusLabel: "Usage limit",
    });
    expect(columnOf(cards, "Running")?.column).toBe("progress");
  });

  it("ignores a manual column while the agent owns the thread", () => {
    const running = thread("alpha", {
      title: "Running",
      runtime: { ...runtime, status: "running" },
    });
    const [card] = board([running], { placements: { [`${local}:${running.id}`]: "done" } });
    expect(card).toMatchObject({ column: "progress", placement: null, locked: true });
  });

  it("keeps a pending request ahead of snooze and settlement", () => {
    const asking = thread("alpha", {
      title: "Asking",
      hasPendingApprovals: true,
      runtime,
      settledOverride: "settled",
      snoozedUntil: "2026-10-21T08:00:00.000Z",
    });
    expect(board([asking])[0]).toMatchObject({
      column: "review",
      locked: true,
      statusLabel: "Pending Approval",
    });
  });

  it("leaves settlement alone when the server cannot settle", () => {
    const settled = thread("alpha", { title: "Settled", runtime, settledOverride: "settled" });
    expect(board([settled], { canSettle: false })[0]?.column).toBe("todo");
  });

  it("scopes a project board and skips archived threads", () => {
    const alpha = thread("alpha", { title: "Alpha thread", runtime });
    const beta = thread("beta", { title: "Beta thread", runtime });
    const archived = thread("alpha", {
      title: "Archived",
      runtime,
      archivedAt: "2026-10-01T00:00:00.000Z",
    });
    const cards = board([alpha, beta, archived], { projectKey: "alpha" });
    expect(cards.map((card) => card.title)).toEqual(["Alpha thread"]);
  });
});

describe("filterTaskCards", () => {
  it("filters by project, provider, and column, and counts before the column filter", () => {
    const cards = board([
      thread("alpha", { title: "One", runtime }),
      thread("alpha", {
        title: "Two",
        runtime: { ...runtime, status: "running", providerName: "Claude" },
      }),
      thread("beta", { title: "Three", runtime }),
    ]);
    const scoped = filterTaskCards(cards, { projectKey: "alpha", provider: null, column: null });
    expect(countTaskColumns(scoped)).toMatchObject({ todo: 1, progress: 1 });
    expect(
      filterTaskCards(scoped, { projectKey: null, provider: "Claude", column: null }).map(
        (card) => card.title,
      ),
    ).toEqual(["Two"]);
    expect(
      filterTaskCards(cards, { projectKey: null, provider: null, column: "todo" }).map(
        (card) => card.projectName,
      ),
    ).toEqual(["Alpha", "Beta"]);
  });
});

describe("planTaskMove", () => {
  const resting = {
    column: "todo" as const,
    locked: false,
    snoozed: false,
    settled: false,
  };

  it("settles a move to Done and refuses columns the agent owns", () => {
    expect(planTaskMove({ card: resting, target: "done", canSettle: true })).toEqual({
      placement: "done",
      effects: ["settle"],
    });
    expect(planTaskMove({ card: resting, target: "progress", canSettle: true })).toBeNull();
    expect(
      planTaskMove({ card: { ...resting, locked: true }, target: "done", canSettle: true }),
    ).toBeNull();
    expect(planTaskMove({ card: resting, target: "todo", canSettle: true })).toBeNull();
  });

  it("wakes a snoozed thread and unsettles a settled one when leaving Done", () => {
    expect(
      planTaskMove({
        card: { column: "blocked", locked: false, snoozed: true, settled: true },
        target: "todo",
        canSettle: true,
      }),
    ).toEqual({ placement: "todo", effects: ["unsnooze", "unsettle"] });
    expect(
      planTaskMove({
        card: { column: "done", locked: false, snoozed: false, settled: true },
        target: "review",
        canSettle: false,
      }),
    ).toEqual({ placement: "review", effects: [] });
  });
});

describe("dropTargetColumn", () => {
  const cards = [{ key: "local:1", column: "review" as const }];

  it("reads a column from the column or the card dropped on", () => {
    expect(dropTargetColumn("column:done", cards)).toBe("done");
    expect(dropTargetColumn("card:local:1", cards)).toBe("review");
    expect(dropTargetColumn("column:nope", cards)).toBeNull();
  });
});
