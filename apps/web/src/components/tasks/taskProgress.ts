export interface TaskStepProgress {
  readonly planned: number;
  readonly completed: number;
  readonly running: number;
  readonly pending: number;
  readonly blocked: number;
  /** Whole percent complete, or null when nothing was planned. */
  readonly percent: number | null;
}

export interface TaskStepThreadSignal {
  readonly activityStatus: string;
  readonly latestRunStatus: string | null;
  readonly awaitingPlan: boolean;
}

export interface TaskStepProgressPlan {
  readonly proposed: { readonly status: string } | null;
  readonly todo: {
    readonly steps: readonly { readonly status: "pending" | "running" | "completed" }[];
  } | null;
}

// Contract steps are only pending, running, or completed. Unfinished ones count
// as blocked while the thread waits on a person (approval, input, a guest, or a
// proposed plan awaiting approval), or the run failed, was interrupted, or
// stopped with steps left undone. An active run keeps pending and running.
export function taskStepBlockReason(input: TaskStepThreadSignal): string | null {
  switch (input.activityStatus) {
    case "Pending Approval":
      return "Waiting for approval";
    case "Awaiting Input":
      return "Waiting for your input";
    case "Guest Request":
      return "Waiting on a guest";
    case "Working":
    case "Connecting":
    case "Waiting":
      return null;
    default:
      break;
  }
  if (input.activityStatus === "Failed" || input.latestRunStatus === "failed") {
    return "The run failed";
  }
  if (input.latestRunStatus === "interrupted") return "The run was interrupted";
  if (input.latestRunStatus === "cancelled") return "The run was cancelled";
  if (input.latestRunStatus === "rolled_back") return "The run was rolled back";
  if (input.activityStatus === "Plan Ready" || input.awaitingPlan) {
    return "Plan awaiting approval";
  }
  if (input.activityStatus === "Usage limit") return "Usage limit";
  if (input.activityStatus === "Snoozed") return "Snoozed";
  return "Stopped with steps unfinished";
}

export function countTaskStepProgress(
  steps: readonly { readonly status: "pending" | "running" | "completed" }[],
  blockedReason: string | null,
): TaskStepProgress {
  let completed = 0;
  let running = 0;
  let pending = 0;
  let blocked = 0;
  for (const step of steps) {
    if (step.status === "completed") {
      completed += 1;
      continue;
    }
    if (blockedReason !== null) {
      blocked += 1;
      continue;
    }
    if (step.status === "running") running += 1;
    else pending += 1;
  }
  const planned = steps.length;
  return {
    planned,
    completed,
    running,
    pending,
    blocked,
    percent: planned === 0 ? null : Math.round((completed / planned) * 100),
  };
}

export function sumTaskStepProgress(rows: readonly TaskStepProgress[]): TaskStepProgress {
  let planned = 0;
  let completed = 0;
  let running = 0;
  let pending = 0;
  let blocked = 0;
  for (const row of rows) {
    planned += row.planned;
    completed += row.completed;
    running += row.running;
    pending += row.pending;
    blocked += row.blocked;
  }
  return {
    planned,
    completed,
    running,
    pending,
    blocked,
    percent: planned === 0 ? null : Math.round((completed / planned) * 100),
  };
}

export function taskThreadStepProgress(
  thread: Omit<TaskStepThreadSignal, "awaitingPlan">,
  plan: TaskStepProgressPlan | null,
): { readonly progress: TaskStepProgress; readonly blockedReason: string | null } {
  const blockedReason = taskStepBlockReason({
    ...thread,
    awaitingPlan: plan?.proposed?.status === "active",
  });
  const progress = countTaskStepProgress(plan?.todo?.steps ?? [], blockedReason);
  return { progress, blockedReason: progress.blocked > 0 ? blockedReason : null };
}

export function describeTaskStepProgress(
  progress: TaskStepProgress,
  blockedReason: string | null,
): string {
  if (progress.planned === 0 || progress.percent === null) return "No steps planned";
  const reason = blockedReason === null ? "" : ` Blocked: ${blockedReason}.`;
  return `${progress.completed} of ${progress.planned} steps complete, ${progress.percent} percent. ${progress.running} running, ${progress.pending} pending, ${progress.blocked} blocked.${reason}`;
}

export function compareTaskProgressPercent(
  left: { readonly percent: number | null; readonly title: string },
  right: { readonly percent: number | null; readonly title: string },
  direction: "asc" | "desc",
): number {
  if (left.percent === null || right.percent === null) {
    if (left.percent === right.percent) return left.title.localeCompare(right.title);
    return left.percent === null ? 1 : -1;
  }
  const delta = direction === "asc" ? left.percent - right.percent : right.percent - left.percent;
  return delta === 0 ? left.title.localeCompare(right.title) : delta;
}
