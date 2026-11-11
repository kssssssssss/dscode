import type {
  EnvironmentId,
  PlannedTask,
  PlannedTaskExecution,
  ThreadId,
} from "@t3tools/contracts";
import { lazy, Suspense, useRef, useState } from "react";

import { cn } from "../../lib/utils";
import { useAtomCommand } from "../../state/use-atom-command";
import { plannedTasksEnvironment } from "../../state/plannedTasks";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import {
  plannedTaskForest,
  plannedTaskKey,
  sameTaskNumber,
  summarizePlannedTasks,
  type PlannedTaskLink,
  type PlannedTaskNode,
} from "./plannedTaskModel";

const TaskMarkdown = lazy(() => import("../ChatMarkdown"));

const EXECUTION_COLUMNS: readonly {
  readonly id: PlannedTaskExecution;
  readonly label: string;
  readonly detail: string;
  readonly bar: string;
}[] = [
  { id: "open", label: "Open", detail: "Not started", bar: "bg-info" },
  { id: "claimed", label: "Claimed", detail: "In progress", bar: "bg-warning" },
  {
    id: "blocked",
    label: "Blocked",
    detail: "Execution blocked",
    bar: "bg-error",
  },
  { id: "unknown", label: "Unknown", detail: "Not tracked", bar: "bg-muted-foreground" },
  {
    id: "resolved",
    label: "Resolved",
    detail: "Accepted",
    bar: "bg-success",
  },
];

export interface PlannedBoardTask extends PlannedTask {
  readonly projectKey: string;
  readonly projectName: string;
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
}

export interface PlannedBoardThread {
  readonly key: string;
  readonly projectKey: string | null;
  readonly title: string;
  readonly statusLabel: string;
  readonly child: boolean;
  readonly manual: boolean;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}

export function PlannedTaskProgress(props: {
  readonly tasks: readonly PlannedBoardTask[];
  readonly pending: boolean;
  readonly error: string | null;
  readonly notes: readonly string[];
  readonly showProject: boolean;
}) {
  const summary = summarizePlannedTasks(props.tasks);
  const acceptancePercent =
    summary.acceptanceTotal === 0
      ? null
      : Math.round((summary.acceptanceChecked / summary.acceptanceTotal) * 100);
  const forest = plannedTaskForest(props.tasks);
  return (
    <section aria-label="Planned task progress" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-sm font-medium">Planned tasks</h2>
        <p className="text-xs text-muted-foreground">
          {summary.taskCount} tasks · {summary.ready} ready
          {acceptancePercent === null ? "" : ` · ${acceptancePercent}% accepted`}
        </p>
      </div>
      <p className="text-xs text-muted-foreground">
        Counts each task once. A finished thread does not accept a task, and a parent rollup is
        labeled separately from this total.
      </p>
      {summary.taskCount > 0 ? (
        <div
          role="img"
          aria-label={executionLabel(summary.byExecution)}
          className="flex h-2 w-full overflow-hidden rounded-full bg-foreground/10"
        >
          {EXECUTION_COLUMNS.map((column) => {
            const count = summary.byExecution[column.id];
            if (count === 0) return null;
            return (
              <div
                key={column.id}
                className={cn("h-full min-w-0 basis-0", column.bar)}
                style={{ flexGrow: count }}
              />
            );
          })}
        </div>
      ) : null}
      <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground tabular-nums">
        {EXECUTION_COLUMNS.map((column) => (
          <span key={column.id}>
            {summary.byExecution[column.id]} {column.label.toLowerCase()}
          </span>
        ))}
        <span>
          {summary.acceptanceChecked}/{summary.acceptanceTotal} acceptance checks
        </span>
      </p>
      {summary.acceptanceTotal > 0 ? (
        <div
          role="img"
          aria-label={`${summary.acceptanceChecked} of ${summary.acceptanceTotal} acceptance checks`}
          className="flex h-1.5 w-full overflow-hidden rounded-full bg-foreground/10"
        >
          {summary.acceptanceChecked > 0 ? (
            <div
              className="h-full min-w-0 basis-0 bg-success"
              style={{ flexGrow: summary.acceptanceChecked }}
            />
          ) : null}
          {summary.acceptanceTotal - summary.acceptanceChecked > 0 ? (
            <div
              className="h-full min-w-0 basis-0 bg-muted-foreground"
              style={{ flexGrow: summary.acceptanceTotal - summary.acceptanceChecked }}
            />
          ) : null}
        </div>
      ) : null}
      {forest.some((node) => node.children.length > 0) ? (
        <div className="flex max-h-48 flex-col gap-1 overflow-auto">
          <h3 className="text-xs font-medium text-muted-foreground">Hierarchy</h3>
          {forest.map((node) => (
            <HierarchyNode
              key={`${node.task.projectKey}:${node.task.relativePath}`}
              node={node}
              depth={0}
              showProject={props.showProject}
            />
          ))}
        </div>
      ) : null}
      {props.pending ? (
        <p className="text-xs text-muted-foreground">Loading planned tasks…</p>
      ) : null}
      {props.error ? <p className="text-xs text-muted-foreground">{props.error}</p> : null}
      {props.notes.map((note) => (
        <p key={note} className="text-xs text-muted-foreground">
          {note}
        </p>
      ))}
    </section>
  );
}

export function PlannedTaskBoard(props: {
  readonly tasks: readonly PlannedBoardTask[];
  readonly threadsByTask: ReadonlyMap<string, readonly PlannedBoardThread[]>;
  readonly linkChoices: readonly PlannedBoardThread[];
  readonly showProject: boolean;
  readonly onLink: (threadKey: string, link: PlannedTaskLink | null | "auto") => void;
  readonly onOpenThread: (thread: PlannedBoardThread) => void;
}) {
  const [openTask, setOpenTask] = useState<PlannedBoardTask | null>(null);
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const request = useRef(0);
  const readTask = useAtomCommand(plannedTasksEnvironment.read, { reportFailure: false });
  const open = (task: PlannedBoardTask) => {
    const id = request.current + 1;
    request.current = id;
    setOpenTask(task);
    setMarkdown(null);
    setReadError(null);
    void readTask({
      environmentId: task.environmentId,
      input: { cwd: task.cwd, relativePath: task.relativePath },
    }).then((result) => {
      if (request.current !== id) return;
      if (result._tag === "Success") setMarkdown(result.value.markdown);
      else setReadError("Could not open this task.");
    });
  };
  return (
    <div className="flex min-h-full w-full min-w-0 flex-col gap-4 py-4 md:h-full">
      {props.tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No planned tasks in this view. Issues live in tasks/&lt;topic&gt;/issues/NN-title.md, or
          in the glob from .t3/task-board.json.
        </p>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
          {EXECUTION_COLUMNS.map((column) => {
            const cards = props.tasks
              .filter((task) => task.execution === column.id)
              .sort(
                (left, right) =>
                  Number(right.ready) - Number(left.ready) ||
                  Number(left.number) - Number(right.number) ||
                  left.title.localeCompare(right.title),
              );
            return (
              <section
                key={column.id}
                aria-label={column.label}
                className="flex min-w-0 flex-col gap-2"
              >
                <header className="flex items-baseline justify-between gap-2">
                  <h2 className="text-sm font-medium">{column.label}</h2>
                  <p className="text-xs text-muted-foreground">
                    {column.detail} · {cards.length}
                  </p>
                </header>
                <div className="flex flex-col gap-2">
                  {cards.map((task) => (
                    <PlannedTaskCard
                      key={`${task.projectKey}:${task.relativePath}`}
                      task={task}
                      tasks={props.tasks}
                      threads={
                        props.threadsByTask.get(
                          plannedTaskKey(task.projectKey, task.topic, task.number),
                        ) ?? []
                      }
                      linkChoices={props.linkChoices}
                      showProject={props.showProject}
                      onOpen={() => open(task)}
                      onOpenThread={props.onOpenThread}
                      onLink={props.onLink}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
      <Dialog
        open={openTask !== null}
        onOpenChange={(next) => {
          if (!next) {
            request.current += 1;
            setOpenTask(null);
          }
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>
              {openTask ? `#${openTask.number} ${openTask.title}` : "Planned task"}
            </DialogTitle>
            {openTask ? <DialogDescription>{openTask.relativePath}</DialogDescription> : null}
          </DialogHeader>
          <DialogPanel>
            {readError ? <p className="text-sm text-muted-foreground">{readError}</p> : null}
            {markdown === null && readError === null ? (
              <p className="text-sm text-muted-foreground">Opening task…</p>
            ) : null}
            {markdown !== null && openTask ? (
              <Suspense fallback={<p className="text-sm text-muted-foreground">Opening task…</p>}>
                <TaskMarkdown
                  text={markdown}
                  cwd={undefined}
                  environmentId={openTask.environmentId}
                  isStreaming={false}
                />
              </Suspense>
            ) : null}
          </DialogPanel>
        </DialogPopup>
      </Dialog>
    </div>
  );
}

function PlannedTaskCard(props: {
  readonly task: PlannedBoardTask;
  readonly tasks: readonly PlannedBoardTask[];
  readonly threads: readonly PlannedBoardThread[];
  readonly linkChoices: readonly PlannedBoardThread[];
  readonly showProject: boolean;
  readonly onOpen: () => void;
  readonly onOpenThread: (thread: PlannedBoardThread) => void;
  readonly onLink: (threadKey: string, link: PlannedTaskLink | null | "auto") => void;
}) {
  const { task } = props;
  const choices = props.linkChoices.filter(
    (thread) =>
      thread.projectKey === task.projectKey &&
      !props.threads.some((linked) => linked.key === thread.key),
  );
  return (
    <article className="flex flex-col gap-2 rounded-lg border border-(--panel-edge) bg-(--panel-surface) p-3">
      <button
        type="button"
        onClick={props.onOpen}
        className="cursor-pointer text-left text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <span className="text-muted-foreground tabular-nums">#{task.number}</span> {task.title}
      </button>
      <div className="flex flex-wrap items-center gap-1.5">
        {props.showProject ? (
          <span className="text-xs text-muted-foreground">{task.projectName}</span>
        ) : null}
        <span className="text-xs text-muted-foreground">{task.topic}</span>
        {task.status ? (
          <span className="rounded-md bg-foreground/5 px-1.5 py-0.5 text-2xs text-foreground">
            {task.status}
          </span>
        ) : null}
        {task.ready ? (
          <span className="rounded-md bg-info/15 px-1.5 py-0.5 text-2xs text-info-foreground">
            Ready
          </span>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground tabular-nums">
        {task.acceptanceChecked}/{task.acceptanceTotal} accepted
        {task.lastHistoryDate ? ` · history ${task.lastHistoryDate}` : ""}
      </p>
      {task.blockedBy.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {task.blockedBy.map((dependency) => {
            const met = dependencyMet(props.tasks, task, dependency);
            return (
              <span
                key={dependency}
                className={cn(
                  "rounded-md px-1.5 py-0.5 text-2xs tabular-nums",
                  met
                    ? "bg-foreground/5 text-muted-foreground"
                    : "bg-warning/15 text-warning-foreground",
                )}
              >
                #{dependency}
                {met ? "" : " unmet"}
              </span>
            );
          })}
        </div>
      ) : null}
      {task.parent.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Parent {task.parent.map((parent) => `#${parent}`).join(", ")}
        </p>
      ) : null}
      {props.threads.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {props.threads.map((thread) => (
            <li key={thread.key} className="flex min-w-0 items-center gap-1">
              <button
                type="button"
                onClick={() => props.onOpenThread(thread)}
                className="min-w-0 flex-1 cursor-pointer truncate text-left text-xs outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                {thread.child ? "Child · " : ""}
                {thread.title} · {thread.statusLabel}
              </button>
              {thread.manual ? (
                <button
                  type="button"
                  onClick={() => props.onLink(thread.key, "auto")}
                  className="cursor-pointer text-2xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  Automatic
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => props.onLink(thread.key, null)}
                className="cursor-pointer text-2xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                Unlink
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {choices.length > 0 ? (
        <label className="flex items-center gap-1.5 text-2xs text-muted-foreground">
          <span>Link</span>
          <select
            aria-label={`Link a thread to task ${task.number}`}
            value=""
            onChange={(event) => {
              const key = event.target.value;
              if (key.length > 0) props.onLink(key, { topic: task.topic, number: task.number });
            }}
            className="h-7 min-w-0 flex-1 cursor-pointer truncate rounded-md bg-transparent text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <option value="">Choose a thread</option>
            {choices.map((thread) => (
              <option key={thread.key} value={thread.key}>
                {thread.child ? "Child · " : ""}
                {thread.title}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </article>
  );
}

function HierarchyNode(props: {
  readonly node: PlannedTaskNode<PlannedBoardTask>;
  readonly depth: number;
  readonly showProject: boolean;
}) {
  const { task, children, rollupChecked, rollupTotal } = props.node;
  return (
    <div className="flex flex-col gap-1" style={{ paddingLeft: props.depth * 12 }}>
      <p className="truncate text-xs">
        {props.showProject ? `${task.projectName} · ` : ""}#{task.number} {task.title}
        <span className="text-muted-foreground">
          {" "}
          · own {task.acceptanceChecked}/{task.acceptanceTotal}
          {children.length > 0 ? ` · including children ${rollupChecked}/${rollupTotal}` : ""}
        </span>
      </p>
      {children.map((child) => (
        <HierarchyNode
          key={`${child.task.projectKey}:${child.task.relativePath}`}
          node={child}
          depth={props.depth + 1}
          showProject={false}
        />
      ))}
    </div>
  );
}

function dependencyMet(
  tasks: readonly PlannedBoardTask[],
  task: PlannedBoardTask,
  dependency: string,
): boolean {
  return tasks.some(
    (other) =>
      other.projectKey === task.projectKey &&
      other.topic === task.topic &&
      sameTaskNumber(other.number, dependency) &&
      other.execution === "resolved",
  );
}

function executionLabel(counts: Record<PlannedTaskExecution, number>): string {
  return EXECUTION_COLUMNS.map(
    (column) => `${counts[column.id]} ${column.label.toLowerCase()}`,
  ).join(", ");
}
