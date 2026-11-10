import { effectiveSnoozed } from "@t3tools/client-runtime/state/thread-settled";
import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";

import type { SidebarThreadSummary } from "../../types";
import { filterSidebarV2VisibleThreads, resolveThreadStatusPill } from "../Sidebar.logic";

export const TASK_COLUMNS = [
  { id: "todo", label: "To do", manual: true },
  { id: "progress", label: "In progress", manual: false },
  { id: "review", label: "Needs review", manual: true },
  { id: "blocked", label: "Blocked", manual: false },
  { id: "done", label: "Done", manual: true },
] as const;

export type TaskColumnId = (typeof TASK_COLUMNS)[number]["id"];
export type ManualTaskColumn = Extract<(typeof TASK_COLUMNS)[number], { manual: true }>["id"];

const MANUAL_COLUMNS = new Set<TaskColumnId>(
  TASK_COLUMNS.filter((column) => column.manual).map((column) => column.id),
);

const LIVE_COLUMNS = {
  Working: "progress",
  Connecting: "progress",
  "Pending Approval": "review",
  "Awaiting Input": "review",
  "Guest Request": "review",
  "Plan Ready": "review",
  Waiting: "blocked",
  Failed: "blocked",
} as const;

export function isTaskColumnId(value: string): value is TaskColumnId {
  return TASK_COLUMNS.some((column) => column.id === value);
}

export function isManualTaskColumn(value: string): value is ManualTaskColumn {
  return (MANUAL_COLUMNS as ReadonlySet<string>).has(value);
}

function taskColumnLabel(column: TaskColumnId): string {
  return TASK_COLUMNS.find((entry) => entry.id === column)?.label ?? column;
}

export interface TaskClassification {
  readonly column: TaskColumnId;
  /** The agent or a pending request owns the column. */
  readonly locked: boolean;
  readonly snoozed: boolean;
  readonly settled: boolean;
  readonly statusLabel: string;
}

function classifyTaskThread(
  thread: SidebarThreadSummary,
  options: { readonly now: string; readonly canSettle: boolean; readonly canSnooze: boolean },
): TaskClassification {
  const pill = resolveThreadStatusPill({ thread });
  const snoozed = options.canSnooze && effectiveSnoozed(thread, { now: options.now });
  const settled = options.canSettle && thread.settledOverride === "settled";
  if (pill && pill.label !== "Completed") {
    return {
      column: LIVE_COLUMNS[pill.label],
      locked: true,
      snoozed,
      settled,
      statusLabel: pill.label,
    };
  }
  if (
    thread.limitRecovery != null ||
    thread.runtime?.usageLimitResetAt != null ||
    thread.runtime?.lastErrorClass === "usage_limit"
  ) {
    return { column: "blocked", locked: true, snoozed, settled, statusLabel: "Usage limit" };
  }
  if (snoozed) {
    return { column: "blocked", locked: false, snoozed: true, settled, statusLabel: "Snoozed" };
  }
  if (settled) {
    return { column: "done", locked: false, snoozed: false, settled: true, statusLabel: "Settled" };
  }
  if (pill?.label === "Completed") {
    return { column: "review", locked: false, snoozed: false, settled, statusLabel: "Completed" };
  }
  return { column: "todo", locked: false, snoozed: false, settled, statusLabel: "Idle" };
}

function effectiveTaskColumn(
  classification: Pick<TaskClassification, "column" | "locked">,
  placement: ManualTaskColumn | null,
): TaskColumnId {
  if (classification.locked || placement === null) return classification.column;
  return placement;
}

export interface TaskCard {
  readonly key: string;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly projectKey: string | null;
  readonly projectName: string;
  readonly title: string;
  readonly provider: string;
  readonly branch: string | null;
  readonly column: TaskColumnId;
  readonly derivedColumn: TaskColumnId;
  readonly locked: boolean;
  readonly snoozed: boolean;
  readonly settled: boolean;
  readonly statusLabel: string;
  readonly activityMs: number | null;
  readonly placement: ManualTaskColumn | null;
  /** Shell flag for an active proposed plan, before the thread snapshot arrives. */
  readonly hasProposedPlan: boolean;
}

export interface TaskProjectGroup {
  readonly projectKey: string;
  readonly displayName: string;
  readonly memberProjects: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly id: ProjectId;
  }>;
}

export function buildTaskCards(input: {
  readonly threads: readonly SidebarThreadSummary[];
  readonly groups: readonly TaskProjectGroup[];
  readonly delegatedUnderParent: ReadonlySet<string>;
  readonly placements: Readonly<Record<string, ManualTaskColumn | undefined>>;
  readonly now: string;
  readonly capabilities: (
    environmentId: EnvironmentId,
  ) => { readonly threadSettlement?: boolean; readonly threadSnooze?: boolean } | undefined;
  readonly projectKey?: string | null;
}): TaskCard[] {
  const projectByMember = new Map<string, { projectKey: string; projectName: string }>();
  for (const group of input.groups) {
    for (const member of group.memberProjects) {
      projectByMember.set(`${member.environmentId}:${member.id}`, {
        projectKey: group.projectKey,
        projectName: group.displayName,
      });
    }
  }
  const scopeGroup =
    input.projectKey == null
      ? null
      : (input.groups.find((group) => group.projectKey === input.projectKey) ?? null);
  const scopedProjectKeys =
    input.projectKey == null
      ? null
      : new Set(
          (scopeGroup?.memberProjects ?? []).map(
            (member) => `${member.environmentId}:${member.id}`,
          ),
        );
  const visible = filterSidebarV2VisibleThreads(
    input.threads.filter((thread) => thread.deletedAt === null),
    scopedProjectKeys,
    input.delegatedUnderParent,
  );
  const cards = visible.map((thread) => {
    const project = projectByMember.get(`${thread.environmentId}:${thread.projectId}`);
    const capabilities = input.capabilities(thread.environmentId);
    const classification = classifyTaskThread(thread, {
      now: input.now,
      canSettle: capabilities?.threadSettlement === true,
      canSnooze: capabilities?.threadSnooze === true,
    });
    const key = `${thread.environmentId}:${thread.id}`;
    const placement = input.placements[key] ?? null;
    const column = effectiveTaskColumn(classification, placement);
    return {
      key,
      environmentId: thread.environmentId,
      threadId: thread.id,
      projectKey: project?.projectKey ?? null,
      projectName: project?.projectName ?? "Unknown project",
      title: thread.title,
      provider: thread.runtime?.providerName?.trim() || thread.providerInstanceId,
      branch: thread.branch,
      column,
      derivedColumn: classification.column,
      locked: classification.locked,
      snoozed: classification.snoozed,
      settled: classification.settled,
      statusLabel:
        !classification.locked && placement !== null && placement !== classification.column
          ? taskColumnLabel(placement)
          : classification.statusLabel,
      activityMs: taskActivityMs(thread),
      placement: classification.locked ? null : placement,
      hasProposedPlan: thread.hasActionableProposedPlan,
    };
  });
  cards.sort(
    (left, right) =>
      (right.activityMs ?? -1) - (left.activityMs ?? -1) ||
      left.title.localeCompare(right.title) ||
      left.key.localeCompare(right.key),
  );
  return cards;
}

function taskActivityMs(thread: SidebarThreadSummary): number | null {
  const stamps = [
    Date.parse(thread.updatedAt),
    thread.latestUserMessageAt === null ? Number.NaN : Date.parse(thread.latestUserMessageAt),
    thread.latestRun?.completedAt == null ? Number.NaN : Date.parse(thread.latestRun.completedAt),
    thread.runtime?.updatedAt == null ? Number.NaN : Date.parse(thread.runtime.updatedAt),
  ].filter((stamp) => Number.isFinite(stamp));
  if (stamps.length === 0) return null;
  return Math.max(...stamps);
}

export interface TaskFilters {
  readonly projectKey: string | null;
  readonly provider: string | null;
  readonly column: TaskColumnId | null;
}

export function filterTaskCards(cards: readonly TaskCard[], filters: TaskFilters): TaskCard[] {
  return cards.filter(
    (card) =>
      (filters.projectKey === null || card.projectKey === filters.projectKey) &&
      (filters.provider === null || card.provider === filters.provider) &&
      (filters.column === null || card.column === filters.column),
  );
}

export function countTaskColumns(cards: readonly TaskCard[]): Record<TaskColumnId, number> {
  const counts: Record<TaskColumnId, number> = {
    todo: 0,
    progress: 0,
    review: 0,
    blocked: 0,
    done: 0,
  };
  for (const card of cards) counts[card.column] += 1;
  return counts;
}

export type TaskMoveEffect = "settle" | "unsettle" | "unsnooze";

export function planTaskMove(input: {
  readonly card: Pick<TaskCard, "column" | "locked" | "snoozed" | "settled">;
  readonly target: TaskColumnId;
  readonly canSettle: boolean;
}): { readonly placement: ManualTaskColumn; readonly effects: readonly TaskMoveEffect[] } | null {
  if (
    input.card.locked ||
    !isManualTaskColumn(input.target) ||
    input.card.column === input.target
  ) {
    return null;
  }
  const effects: TaskMoveEffect[] = [];
  if (input.card.snoozed) effects.push("unsnooze");
  if (input.target === "done") {
    if (!input.card.settled && input.canSettle) effects.push("settle");
  } else if (input.card.settled && input.canSettle) {
    effects.push("unsettle");
  }
  return { placement: input.target, effects };
}

export function taskCardDragId(key: string): string {
  return `card:${key}`;
}

export function taskColumnDropId(column: TaskColumnId): string {
  return `column:${column}`;
}

export function taskCardKeyFromDragId(id: string): string | null {
  if (!id.startsWith("card:")) return null;
  return id.slice("card:".length);
}

export function dropTargetColumn(
  overId: string,
  cards: readonly Pick<TaskCard, "key" | "column">[],
): TaskColumnId | null {
  if (overId.startsWith("column:")) {
    const column = overId.slice("column:".length);
    return isTaskColumnId(column) ? column : null;
  }
  const key = taskCardKeyFromDragId(overId);
  if (key === null) return null;
  return cards.find((card) => card.key === key)?.column ?? null;
}
