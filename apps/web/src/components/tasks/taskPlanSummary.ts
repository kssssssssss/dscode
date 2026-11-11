import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { stripDisplayedPlanMarkdown } from "@t3tools/shared/proposedPlanText";

export const TASK_STEP_COLUMNS = [
  { id: "pending", label: "Pending" },
  { id: "running", label: "Running" },
  { id: "completed", label: "Completed" },
] as const;

export type TaskStepColumnId = (typeof TASK_STEP_COLUMNS)[number]["id"];

export interface TaskPlanRun {
  readonly id: string;
  readonly ordinal: number;
}

export interface TaskPlanSourceStep {
  readonly id: string;
  readonly text: string;
  readonly status: "pending" | "running" | "completed";
  readonly durationMs?: number | undefined;
}

interface TaskPlanSourceBase {
  readonly id: string;
  readonly status: "draft" | "active" | "completed" | "superseded";
  readonly runId: string | null;
  readonly detailInTurnItem?: boolean | undefined;
}

interface TaskTodoPlanSource extends TaskPlanSourceBase {
  readonly kind: "todo_list";
  readonly steps?: readonly TaskPlanSourceStep[] | undefined;
  readonly explanation?: string | undefined;
}

interface TaskProposedPlanSource extends TaskPlanSourceBase {
  readonly kind: "proposed_plan";
  readonly markdown?: string | undefined;
}

export type TaskPlanSource = TaskTodoPlanSource | TaskProposedPlanSource;

export interface TaskTodoStep {
  readonly id: string;
  readonly text: string;
  readonly status: TaskStepColumnId;
  readonly durationMs: number | null;
}

export interface TaskTodoSummary {
  readonly kind: "todo_list";
  readonly id: string;
  readonly sequence: number;
  readonly completed: number;
  readonly total: number;
  readonly runningText: string | null;
  readonly explanation: string | null;
  readonly steps: readonly TaskTodoStep[];
}

export interface TaskProposedSummary {
  readonly kind: "proposed_plan";
  readonly id: string;
  readonly sequence: number;
  readonly status: TaskPlanSource["status"];
  readonly markdown: string;
  readonly stripped: boolean;
}

export type TaskPlanSummary = TaskTodoSummary | TaskProposedSummary;

export interface TaskPlanVersion {
  readonly id: string;
  readonly kind: "todo_list" | "proposed_plan";
  readonly status: TaskPlanSource["status"];
  readonly sequence: number;
  readonly explanation: string | null;
  readonly markdown: string | null;
  readonly steps: readonly TaskTodoStep[];
  readonly stripped: boolean;
}

/** The plans a card can show: the latest todo, the current proposal, and older versions. */
export interface TaskThreadPlans {
  readonly todo: TaskTodoSummary | null;
  readonly proposed: TaskProposedSummary | null;
  readonly previous: readonly TaskPlanVersion[];
}

export interface TaskStepCard {
  readonly key: string;
  readonly column: TaskStepColumnId;
  readonly text: string;
  readonly durationMs: number | null;
  readonly projectName: string;
  readonly projectKey: string | null;
  readonly threadTitle: string;
  readonly threadKey: string;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}

const PROPOSED_RANK: Record<TaskPlanSource["status"], number> = {
  superseded: 0,
  completed: 1,
  draft: 2,
  active: 3,
};

const SEQUENCE_SPAN = 1_000_000;

function sequenceOf(
  runId: string | null,
  index: number,
  ordinalOf: ReadonlyMap<string, number>,
): number {
  const ordinal = runId === null ? -1 : (ordinalOf.get(runId) ?? -1);
  return ordinal * SEQUENCE_SPAN + index;
}

function toSteps(steps: readonly TaskPlanSourceStep[] | undefined): TaskTodoStep[] {
  return (steps ?? []).map((step) => ({
    id: step.id,
    text: step.text,
    status: step.status,
    durationMs: step.durationMs ?? null,
  }));
}

function toVersion(plan: TaskPlanSource, sequence: number): TaskPlanVersion {
  if (plan.kind === "todo_list") {
    const explanation = plan.explanation?.trim() ? plan.explanation.trim() : null;
    return {
      id: plan.id,
      kind: "todo_list",
      status: plan.status,
      sequence,
      explanation,
      markdown: null,
      steps: toSteps(plan.steps),
      stripped: plan.detailInTurnItem === true && plan.explanation === undefined,
    };
  }
  const markdown = plan.markdown ?? "";
  return {
    id: plan.id,
    kind: "proposed_plan",
    status: plan.status,
    sequence,
    explanation: null,
    markdown,
    steps: [],
    stripped: plan.detailInTurnItem === true && markdown.length === 0,
  };
}

function todoSummary(version: TaskPlanVersion): TaskTodoSummary {
  return {
    kind: "todo_list",
    id: version.id,
    sequence: version.sequence,
    completed: version.steps.filter((step) => step.status === "completed").length,
    total: version.steps.length,
    runningText: version.steps.find((step) => step.status === "running")?.text ?? null,
    explanation: version.explanation,
    steps: version.steps,
  };
}

function proposedSummary(version: TaskPlanVersion): TaskProposedSummary {
  return {
    kind: "proposed_plan",
    id: version.id,
    sequence: version.sequence,
    status: version.status,
    markdown: version.markdown ?? "",
    stripped: version.stripped,
  };
}

function versionVisible(version: TaskPlanVersion): boolean {
  if (version.kind === "proposed_plan") return true;
  return version.steps.length > 0 || version.explanation !== null || version.stripped;
}

export function collectTaskPlans(input: {
  readonly plans: readonly TaskPlanSource[];
  readonly runs: readonly TaskPlanRun[];
}): TaskThreadPlans {
  const ordinalOf = new Map(input.runs.map((run) => [run.id, run.ordinal]));
  const versions = input.plans.map((plan, index) =>
    toVersion(plan, sequenceOf(plan.runId, index, ordinalOf)),
  );
  let todo: TaskPlanVersion | null = null;
  for (const version of versions) {
    if (
      version.kind !== "todo_list" ||
      version.status === "superseded" ||
      version.steps.length === 0
    ) {
      continue;
    }
    if (todo === null || version.sequence >= todo.sequence) todo = version;
  }
  let proposed: TaskPlanVersion | null = null;
  let proposedRank = 0;
  for (const version of versions) {
    if (version.kind !== "proposed_plan") continue;
    const rank = PROPOSED_RANK[version.status];
    if (
      rank > proposedRank ||
      (rank === proposedRank &&
        rank > 0 &&
        proposed !== null &&
        version.sequence >= proposed.sequence)
    ) {
      proposed = version;
      proposedRank = rank;
    }
  }
  const previous = versions
    .filter(
      (version) =>
        versionVisible(version) && version.id !== todo?.id && version.id !== proposed?.id,
    )
    .sort((left, right) => right.sequence - left.sequence);
  return {
    todo: todo ? todoSummary(todo) : null,
    proposed: proposed ? proposedSummary(proposed) : null,
    previous,
  };
}

export function proposedPlanLabel(status: TaskProposedSummary["status"]): string {
  switch (status) {
    case "active":
      return "Plan awaiting approval";
    case "draft":
      return "Draft plan";
    case "completed":
      return "Plan completed";
    case "superseded":
      return "Plan superseded";
  }
}

export function planPreviewLines(markdown: string, maxLines = 3): string[] {
  return stripDisplayedPlanMarkdown(markdown)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, maxLines);
}

export function formatStepDuration(durationMs: number): string {
  if (durationMs < 1_000) return `${Math.round(durationMs)}ms`;
  const seconds = durationMs / 1_000;
  if (seconds < 60) {
    const shown = seconds >= 10 ? seconds.toFixed(0) : seconds.toFixed(1).replace(/\.0$/, "");
    return `${shown}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
}

const SHELL_PROPOSED: TaskProposedSummary = {
  kind: "proposed_plan",
  id: "",
  sequence: -1,
  status: "active",
  markdown: "",
  stripped: false,
};

export function taskPlanForCard(
  loaded: TaskThreadPlans | null | undefined,
  hasProposedPlan: boolean,
): TaskThreadPlans | null {
  if (loaded !== undefined) return loaded;
  return hasProposedPlan ? { todo: null, proposed: SHELL_PROPOSED, previous: [] } : null;
}

function preferVersion(left: TaskPlanVersion, right: TaskPlanVersion): TaskPlanVersion {
  const newer = left.sequence >= right.sequence ? left : right;
  const older = newer === left ? right : left;
  if (!newer.stripped) return newer;
  if (older.stripped) return newer;
  return {
    ...newer,
    markdown: newer.markdown && newer.markdown.length > 0 ? newer.markdown : older.markdown,
    explanation: newer.explanation ?? older.explanation,
    steps: newer.steps.length > 0 ? newer.steps : older.steps,
    stripped: false,
  };
}

function summaryVersion(summary: TaskPlanSummary): TaskPlanVersion {
  if (summary.kind === "todo_list") {
    return {
      id: summary.id,
      kind: "todo_list",
      status: "active",
      sequence: summary.sequence,
      explanation: summary.explanation,
      markdown: null,
      steps: summary.steps,
      stripped: false,
    };
  }
  return {
    id: summary.id,
    kind: "proposed_plan",
    status: summary.status,
    sequence: summary.sequence,
    explanation: null,
    markdown: summary.markdown,
    steps: [],
    stripped: summary.stripped,
  };
}

function preferProposed(
  live: TaskProposedSummary | null,
  full: TaskProposedSummary | null,
): TaskProposedSummary | null {
  if (live === null) return full;
  if (full === null) return live;
  if (live.id !== full.id) return live.sequence >= full.sequence ? live : full;
  if (live.markdown.length === 0 && full.markdown.length > 0) {
    return { ...live, markdown: full.markdown, stripped: false };
  }
  return live;
}

function preferTodo(
  live: TaskTodoSummary | null,
  full: TaskTodoSummary | null,
): TaskTodoSummary | null {
  if (live === null) return full;
  if (full === null) return live;
  if (live.id !== full.id) return live.sequence >= full.sequence ? live : full;
  if (live.explanation === null && full.explanation !== null) {
    return { ...live, explanation: full.explanation };
  }
  return live;
}

/** Live snapshots keep the newest status. A full snapshot fills bodies the bounded snapshot stripped. */
export function mergeTaskPlans(
  live: TaskThreadPlans | null,
  full: TaskThreadPlans | null,
): TaskThreadPlans | null {
  if (live === null) return full;
  if (full === null) return live;
  const todo = preferTodo(live.todo, full.todo);
  const proposed = preferProposed(live.proposed, full.proposed);
  const versions = new Map<string, TaskPlanVersion>();
  const add = (version: TaskPlanVersion) => {
    if (version.id === todo?.id || version.id === proposed?.id) return;
    const existing = versions.get(version.id);
    versions.set(version.id, existing === undefined ? version : preferVersion(existing, version));
  };
  for (const version of full.previous) add(version);
  for (const version of live.previous) add(version);
  if (full.todo && full.todo.id !== todo?.id) add(summaryVersion(full.todo));
  if (live.todo && live.todo.id !== todo?.id) add(summaryVersion(live.todo));
  if (full.proposed && full.proposed.id !== proposed?.id) add(summaryVersion(full.proposed));
  if (live.proposed && live.proposed.id !== proposed?.id) add(summaryVersion(live.proposed));
  return {
    todo,
    proposed,
    previous: [...versions.values()].sort((left, right) => right.sequence - left.sequence),
  };
}

export function buildTaskSteps(
  cards: readonly {
    readonly key: string;
    readonly environmentId: EnvironmentId;
    readonly threadId: ThreadId;
    readonly projectName: string;
    readonly projectKey: string | null;
    readonly title: string;
  }[],
  plans: ReadonlyMap<string, TaskThreadPlans | null>,
): TaskStepCard[] {
  const steps: TaskStepCard[] = [];
  for (const card of cards) {
    const todo = plans.get(card.key)?.todo;
    if (!todo) continue;
    for (const step of todo.steps) {
      steps.push({
        key: `${card.key}\u0000${step.id}`,
        column: step.status,
        text: step.text,
        durationMs: step.durationMs,
        projectName: card.projectName,
        projectKey: card.projectKey,
        threadTitle: card.title,
        threadKey: card.key,
        environmentId: card.environmentId,
        threadId: card.threadId,
      });
    }
  }
  return steps;
}
