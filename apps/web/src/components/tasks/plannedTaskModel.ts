import type { PlannedTask, PlannedTaskExecution } from "@t3tools/contracts";

export interface PlannedTaskLink {
  readonly topic: string;
  readonly number: string;
}

export interface PlannedLinkThread {
  readonly key: string;
  readonly projectKey: string | null;
  readonly title: string;
  readonly branch: string | null;
  readonly worktreePath: string | null;
  readonly openingText: string | null;
}

export type PlannedTaskManualLinks = Readonly<Record<string, PlannedTaskLink | null | undefined>>;

export interface PlannedProgress {
  readonly taskCount: number;
  readonly ready: number;
  readonly byExecution: Record<PlannedTaskExecution, number>;
  readonly acceptanceChecked: number;
  readonly acceptanceTotal: number;
}

export interface PlannedTaskNode<Task extends PlannedHierarchyTask> {
  readonly task: Task;
  readonly children: readonly PlannedTaskNode<Task>[];
  readonly rollupChecked: number;
  readonly rollupTotal: number;
}

interface PlannedHierarchyTask {
  readonly projectKey: string;
  readonly topic: string;
  readonly number: string;
  readonly parent: readonly string[];
  readonly relativePath: string;
  readonly acceptanceChecked: number;
  readonly acceptanceTotal: number;
}

const EMPTY_COUNTS: Record<PlannedTaskExecution, number> = {
  open: 0,
  claimed: 0,
  blocked: 0,
  resolved: 0,
  unknown: 0,
};

export function sameTaskNumber(left: string, right: string): boolean {
  return /^\d+$/u.test(left) && /^\d+$/u.test(right) && Number(left) === Number(right);
}

export function plannedTaskKey(projectKey: string, topic: string, number: string): string {
  return `${projectKey}\u0000${topic}\u0000${Number(number)}`;
}

// A thread links to a task from its title, branch, worktree, or opening message.
// A manual link replaces that guess, and a manual unlink keeps the guess off.
// Thread run state is not an input: a finished thread is not an accepted task.
export function linkThreadsToPlannedTasks(input: {
  readonly tasks: readonly (Pick<PlannedTask, "topic" | "number"> & {
    readonly projectKey: string;
  })[];
  readonly threads: readonly PlannedLinkThread[];
  readonly manual: PlannedTaskManualLinks;
}): Map<string, readonly string[]> {
  const tasksByProject = new Map<string, Array<(typeof input.tasks)[number]>>();
  for (const task of input.tasks) {
    const list = tasksByProject.get(task.projectKey);
    if (list === undefined) tasksByProject.set(task.projectKey, [task]);
    else list.push(task);
  }
  const threadsByTask = new Map<string, string[]>();
  const add = (projectKey: string, topic: string, number: string, threadKey: string) => {
    const key = plannedTaskKey(projectKey, topic, number);
    const list = threadsByTask.get(key);
    if (list === undefined) threadsByTask.set(key, [threadKey]);
    else if (!list.includes(threadKey)) list.push(threadKey);
  };
  for (const thread of input.threads) {
    if (thread.projectKey === null) continue;
    const tasks = tasksByProject.get(thread.projectKey) ?? [];
    const manual = input.manual[thread.key];
    if (manual === null) continue;
    if (manual !== undefined) {
      const match = tasks.find(
        (task) => task.topic === manual.topic && sameTaskNumber(task.number, manual.number),
      );
      if (match !== undefined) add(thread.projectKey, match.topic, match.number, thread.key);
      continue;
    }
    for (const task of guessTasks(tasks, thread)) {
      add(thread.projectKey, task.topic, task.number, thread.key);
    }
  }
  return threadsByTask;
}

export function summarizePlannedTasks(
  tasks: readonly Pick<
    PlannedTask,
    "execution" | "acceptanceChecked" | "acceptanceTotal" | "ready"
  >[],
): PlannedProgress {
  const byExecution = { ...EMPTY_COUNTS };
  let acceptanceChecked = 0;
  let acceptanceTotal = 0;
  let ready = 0;
  for (const task of tasks) {
    byExecution[task.execution] += 1;
    acceptanceChecked += task.acceptanceChecked;
    acceptanceTotal += task.acceptanceTotal;
    if (task.ready) ready += 1;
  }
  return {
    taskCount: tasks.length,
    ready,
    byExecution,
    acceptanceChecked,
    acceptanceTotal,
  };
}

export function plannedTaskForest<Task extends PlannedHierarchyTask>(
  tasks: readonly Task[],
): readonly PlannedTaskNode<Task>[] {
  const attached = new Set<string>();
  const roots = tasks.filter((task) => parentsOf(task, tasks).length === 0);
  const forest = roots.map((task) => nodeFor(task, tasks, new Set(), attached));
  const cycles: PlannedTaskNode<Task>[] = [];
  for (const task of tasks) {
    if (attached.has(taskIdentity(task))) continue;
    cycles.push(nodeFor(task, tasks, new Set(), attached));
  }
  return [...forest, ...cycles];
}

function parentsOf<Task extends PlannedHierarchyTask>(
  task: Task,
  tasks: readonly Task[],
): readonly Task[] {
  return tasks.filter(
    (candidate) =>
      candidate.projectKey === task.projectKey &&
      candidate.topic === task.topic &&
      candidate.relativePath !== task.relativePath &&
      task.parent.some((parent) => sameTaskNumber(parent, candidate.number)),
  );
}

function nodeFor<Task extends PlannedHierarchyTask>(
  task: Task,
  tasks: readonly Task[],
  visiting: ReadonlySet<string>,
  attached: Set<string>,
): PlannedTaskNode<Task> {
  const identity = taskIdentity(task);
  attached.add(identity);
  if (visiting.has(identity)) {
    return {
      task,
      children: [],
      rollupChecked: task.acceptanceChecked,
      rollupTotal: task.acceptanceTotal,
    };
  }
  const next = new Set(visiting);
  next.add(identity);
  const children = tasks
    .filter(
      (candidate) =>
        candidate.projectKey === task.projectKey &&
        candidate.topic === task.topic &&
        candidate.relativePath !== task.relativePath &&
        candidate.parent.some((parent) => sameTaskNumber(parent, task.number)),
    )
    .map((child) => nodeFor(child, tasks, next, attached));
  return {
    task,
    children,
    rollupChecked:
      task.acceptanceChecked + children.reduce((sum, child) => sum + child.rollupChecked, 0),
    rollupTotal: task.acceptanceTotal + children.reduce((sum, child) => sum + child.rollupTotal, 0),
  };
}

function taskIdentity(task: PlannedHierarchyTask): string {
  return `${task.projectKey}\u0000${task.relativePath}`;
}

function guessTasks<Task extends Pick<PlannedTask, "topic" | "number">>(
  tasks: readonly Task[],
  thread: PlannedLinkThread,
): readonly Task[] {
  const fields = [
    thread.title,
    thread.branch ?? "",
    thread.worktreePath ?? "",
    thread.openingText ?? "",
  ];
  const text = fields.join("\n");
  const strong: Task[] = [];
  const weak: Task[] = [];
  for (const task of tasks) {
    const kind = mentionKind(fields, task.number);
    if (kind === "strong") strong.push(task);
    else if (kind === "weak") weak.push(task);
  }
  return disambiguate(strong.length > 0 ? strong : weak, text);
}

function mentionKind(fields: readonly string[], number: string): "strong" | "weak" | null {
  const forms = numberForms(number);
  for (const field of fields) {
    if (field.length === 0) continue;
    for (const form of forms) {
      if (
        new RegExp(`(?:^|[^\\d])${form}-(?!\\d)`, "u").test(field) ||
        new RegExp(`任务\\s*${form}(?!\\d)`, "u").test(field) ||
        new RegExp(`#${form}(?!\\d)`, "u").test(field)
      ) {
        return "strong";
      }
    }
  }
  const tokens = fields.flatMap((field) => field.match(/\d+/gu) ?? []);
  if (tokens.length === 1 && forms.includes(tokens[0] ?? "")) return "weak";
  return null;
}

function numberForms(number: string): string[] {
  const value = String(Number(number));
  return value === number ? [number] : [number, value];
}

function disambiguate<Task extends Pick<PlannedTask, "topic" | "number">>(
  tasks: readonly Task[],
  text: string,
): readonly Task[] {
  const groups = new Map<string, Task[]>();
  for (const task of tasks) {
    const key = String(Number(task.number));
    const list = groups.get(key);
    if (list === undefined) groups.set(key, [task]);
    else list.push(task);
  }
  const chosen: Task[] = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      const only = group[0];
      if (only !== undefined) chosen.push(only);
      continue;
    }
    const named = group.filter((task) => task.topic.length > 0 && text.includes(task.topic));
    if (named.length === 1) {
      const only = named[0];
      if (only !== undefined) chosen.push(only);
    }
  }
  return chosen;
}
