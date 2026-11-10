import type { EnvironmentId, ThreadId } from "@t3tools/contracts";

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
}

interface TaskTodoPlanSource extends TaskPlanSourceBase {
  readonly kind: "todo_list";
  readonly steps?: readonly TaskPlanSourceStep[] | undefined;
}

interface TaskProposedPlanSource extends TaskPlanSourceBase {
  readonly kind: "proposed_plan";
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
  readonly completed: number;
  readonly total: number;
  readonly runningText: string | null;
  readonly steps: readonly TaskTodoStep[];
}

export interface TaskProposedSummary {
  readonly kind: "proposed_plan";
  readonly status: TaskPlanSource["status"];
}

export type TaskPlanSummary = TaskTodoSummary | TaskProposedSummary;

export interface TaskStepCard {
  readonly key: string;
  readonly column: TaskStepColumnId;
  readonly text: string;
  readonly durationMs: number | null;
  readonly projectName: string;
  readonly projectKey: string | null;
  readonly threadTitle: string;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}

const PROPOSED_RANK: Record<TaskPlanSource["status"], number> = {
  superseded: 0,
  completed: 1,
  draft: 2,
  active: 3,
};

export function selectTaskPlan(input: {
  readonly plans: readonly TaskPlanSource[];
  readonly runs: readonly TaskPlanRun[];
}): TaskPlanSummary | null {
  const ordinalOf = new Map(input.runs.map((run) => [run.id, run.ordinal]));
  let todo: TaskTodoPlanSource | null = null;
  let todoOrdinal = Number.NEGATIVE_INFINITY;
  let todoIndex = -1;
  for (let index = 0; index < input.plans.length; index += 1) {
    const plan = input.plans[index];
    if (!plan || plan.kind !== "todo_list" || plan.status === "superseded" || !plan.steps?.length) {
      continue;
    }
    const ordinal = plan.runId === null ? -1 : (ordinalOf.get(plan.runId) ?? -1);
    if (ordinal > todoOrdinal || (ordinal === todoOrdinal && index > todoIndex)) {
      todo = plan;
      todoOrdinal = ordinal;
      todoIndex = index;
    }
  }
  if (todo?.steps) {
    const steps = todo.steps.map((step) => ({
      id: step.id,
      text: step.text,
      status: step.status,
      durationMs: step.durationMs ?? null,
    }));
    return {
      kind: "todo_list",
      completed: steps.filter((step) => step.status === "completed").length,
      total: steps.length,
      runningText: steps.find((step) => step.status === "running")?.text ?? null,
      steps,
    };
  }

  let proposed: TaskProposedPlanSource | null = null;
  let proposedRank = 0;
  let proposedIndex = -1;
  for (let index = 0; index < input.plans.length; index += 1) {
    const plan = input.plans[index];
    if (!plan || plan.kind !== "proposed_plan") continue;
    const rank = PROPOSED_RANK[plan.status];
    if (rank > proposedRank || (rank === proposedRank && rank > 0 && index > proposedIndex)) {
      proposed = plan;
      proposedRank = rank;
      proposedIndex = index;
    }
  }
  if (!proposed || proposedRank === 0) return null;
  return { kind: "proposed_plan", status: proposed.status };
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

export function taskPlanForCard(
  loaded: TaskPlanSummary | null | undefined,
  hasProposedPlan: boolean,
): TaskPlanSummary | null {
  if (loaded !== undefined) return loaded;
  return hasProposedPlan ? { kind: "proposed_plan", status: "active" } : null;
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
  plans: ReadonlyMap<string, TaskPlanSummary | null>,
): TaskStepCard[] {
  const steps: TaskStepCard[] = [];
  for (const card of cards) {
    const plan = plans.get(card.key);
    if (plan?.kind !== "todo_list") continue;
    for (const step of plan.steps) {
      steps.push({
        key: `${card.key}\u0000${step.id}`,
        column: step.status,
        text: step.text,
        durationMs: step.durationMs,
        projectName: card.projectName,
        projectKey: card.projectKey,
        threadTitle: card.title,
        environmentId: card.environmentId,
        threadId: card.threadId,
      });
    }
  }
  return steps;
}
