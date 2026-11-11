import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { planPlannedTaskRead } from "@t3tools/client-runtime/state/plannedTasks";
import { resolveProjectGraphSource } from "@t3tools/client-runtime/state/project-graph-source";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { Link, useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { useState } from "react";

import { isElectron } from "../../env";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useNowMinute } from "../../hooks/useNowMinute";
import { useThreadActions } from "../../hooks/useThreadActions";
import { useAtomCommand } from "../../state/use-atom-command";
import { orchestrationEnvironment } from "../../state/orchestration";
import { cn } from "../../lib/utils";
import { buildThreadRouteParams } from "../../threadRoutes";
import {
  useAllEnvironmentProjectSnapshotsReady,
  useDelegatedUnderParent,
  useServerConfigs,
  useThreadShells,
} from "../../state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { ScrollArea } from "../ui/scroll-area";
import { SidebarInset } from "../ui/sidebar";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { useSettingsProjectGroups } from "../settings/useSettingsProjectGroups";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { ProjectCommitList } from "./ProjectCommitList";
import { TaskBoard } from "./TaskBoard";
import { TaskStepBoard } from "./TaskStepBoard";
import {
  buildTaskSteps,
  collectTaskPlans,
  mergeTaskPlans,
  proposedPlanLabel,
  taskPlanForCard,
  type TaskThreadPlans,
} from "./taskPlanSummary";
import { taskThreadStepProgress } from "./taskProgress";
import { TaskPlanDialog } from "./taskPlanView";
import { TaskProgressPanel } from "./taskProgressView";
import {
  PlannedTaskBoard,
  PlannedTaskProgress,
  type PlannedBoardTask,
  type PlannedBoardThread,
} from "./plannedTaskBoard";
import {
  linkThreadsToPlannedTasks,
  type PlannedLinkThread,
  type PlannedTaskLink,
} from "./plannedTaskModel";
import {
  usePlannedTaskSnapshots,
  useThreadOpeningTexts,
  type PlannedTaskLoaded,
  type PlannedTaskWorkspace,
} from "./usePlannedTasks";
import { useTaskPlans } from "./useTaskPlans";
import { resolveThreadStatusPill } from "../Sidebar.logic";
import type { TaskPlanEntry } from "./TaskStepBoard";
import {
  buildTaskCards,
  countTaskColumns,
  filterTaskCards,
  isTaskColumnId,
  planTaskMove,
  TASK_COLUMNS,
  type ManualTaskColumn,
  type TaskCard,
  type TaskColumnId,
  type TaskMoveEffect,
} from "./taskBoardModel";

const PLACEMENTS_KEY = "t3code:tasks:placements";
const FILTERS_KEY = "t3code:tasks:filters";
const VIEW_KEY = "t3code:tasks:view";
const LINKS_KEY = "t3code:tasks:task-links";
const TOPIC_KEY = "t3code:tasks:topic";
const TaskViewSchema = Schema.Literals(["threads", "steps", "planned"]);
const PlannedLinksSchema = Schema.Record(
  Schema.String,
  Schema.NullOr(Schema.Struct({ topic: Schema.String, number: Schema.String })),
);
const TopicSchema = Schema.NullOr(Schema.String);
const TaskPlacementsSchema = Schema.Record(
  Schema.String,
  Schema.Literals(["todo", "review", "done"]),
);
const TaskFiltersSchema = Schema.Struct({
  projectKey: Schema.NullOr(Schema.String),
  provider: Schema.NullOr(Schema.String),
  column: Schema.NullOr(Schema.Literals(["todo", "progress", "review", "blocked", "done"])),
});
const EMPTY_PLACEMENTS: Record<string, ManualTaskColumn> = {};
const EMPTY_FILTERS = { projectKey: null, provider: null, column: null };

const MOVE_FAILURE: Record<TaskMoveEffect, string> = {
  settle: "Could not settle thread",
  unsettle: "Could not move thread back",
  unsnooze: "Could not wake thread",
};

export function TaskBoardPage(props: {
  readonly projectKey?: string | undefined;
  readonly checkout?: string | undefined;
}) {
  const navigate = useNavigate();
  const groups = useSettingsProjectGroups();
  const threads = useThreadShells();
  const delegatedUnderParent = useDelegatedUnderParent();
  const serverConfigs = useServerConfigs();
  const projectsReady = useAllEnvironmentProjectSnapshotsReady();
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const nowMinute = useNowMinute();
  const now = `${nowMinute}:00.000Z`;
  const { settleThread, unsettleThread, unsnoozeThread } = useThreadActions();
  const [placements, setPlacements] = useLocalStorage(
    PLACEMENTS_KEY,
    EMPTY_PLACEMENTS,
    TaskPlacementsSchema,
  );
  const [filters, setFilters] = useLocalStorage(FILTERS_KEY, EMPTY_FILTERS, TaskFiltersSchema);
  const [view, setView] = useLocalStorage(VIEW_KEY, "threads", TaskViewSchema);
  const [taskLinks, setTaskLinks] = useLocalStorage(LINKS_KEY, {}, PlannedLinksSchema);
  const [topicFilter, setTopicFilter] = useLocalStorage(TOPIC_KEY, null, TopicSchema);
  const project = props.projectKey
    ? (groups.find((group) => group.projectKey === props.projectKey) ?? null)
    : null;
  const cards = buildTaskCards({
    threads,
    groups,
    delegatedUnderParent,
    placements,
    now,
    capabilities: (environmentId) => serverConfigs.get(environmentId)?.environment.capabilities,
    ...(props.projectKey ? { projectKey: props.projectKey } : {}),
  });
  const projectFilter =
    props.projectKey != null
      ? null
      : filters.projectKey !== null &&
          groups.some((group) => group.projectKey === filters.projectKey)
        ? filters.projectKey
        : null;
  const projectScoped = filterTaskCards(cards, {
    projectKey: projectFilter,
    provider: null,
    column: null,
  });
  const providers = [...new Set(projectScoped.map((card) => card.provider))].sort((left, right) =>
    left.localeCompare(right),
  );
  const provider =
    filters.provider !== null && providers.includes(filters.provider) ? filters.provider : null;
  const counted = filterTaskCards(projectScoped, { projectKey: null, provider, column: null });
  const counts = countTaskColumns(counted);
  const column = filters.column !== null && isTaskColumnId(filters.column) ? filters.column : null;
  const visible = filterTaskCards(counted, { projectKey: null, provider: null, column });
  const livePlans = useTaskPlans(counted);
  const [fullPlans, setFullPlans] = useState<ReadonlyMap<string, TaskThreadPlans>>(new Map());
  const [historyLoading, setHistoryLoading] = useState<ReadonlySet<string>>(new Set());
  const [historyError, setHistoryError] = useState<ReadonlyMap<string, string>>(new Map());
  const [reader, setReader] = useState<{
    readonly key: string;
    readonly title: string;
    readonly environmentId: TaskCard["environmentId"];
    readonly threadId: TaskCard["threadId"];
  } | null>(null);
  const loadPlanSnapshot = useAtomCommand(orchestrationEnvironment.threadPlanSnapshot, {
    reportFailure: false,
  });
  const planFor = (card: TaskCard) =>
    mergeTaskPlans(
      taskPlanForCard(livePlans.get(card.key), card.hasProposedPlan),
      fullPlans.get(card.key) ?? null,
    );
  const steps = buildTaskSteps(visible, new Map(visible.map((card) => [card.key, planFor(card)])));
  const planEntries: TaskPlanEntry[] = [];
  for (const card of visible) {
    const proposed = planFor(card)?.proposed;
    if (!proposed || planFor(card)?.todo) continue;
    const preview = proposed.markdown.trim().split("\n")[0] ?? "";
    planEntries.push({
      key: card.key,
      title: card.title,
      detail: preview.length > 0 ? preview : proposedPlanLabel(proposed.status),
    });
  }
  const member =
    project?.memberProjects.find(
      (entry) => `${entry.environmentId}:${entry.id}` === props.checkout,
    ) ??
    project?.memberProjects[0] ??
    null;
  const gitEnvironmentId =
    member === null
      ? null
      : resolveProjectGraphSource({ owner: member.environmentId, environments });

  const loadHistory = async (card: Pick<TaskCard, "key" | "environmentId" | "threadId">) => {
    if (historyLoading.has(card.key)) return;
    setHistoryLoading((current) => new Set(current).add(card.key));
    setHistoryError((current) => {
      if (!current.has(card.key)) return current;
      const next = new Map(current);
      next.delete(card.key);
      return next;
    });
    const result = await loadPlanSnapshot({
      environmentId: card.environmentId,
      input: { threadId: card.threadId },
    });
    setHistoryLoading((current) => {
      const next = new Set(current);
      next.delete(card.key);
      return next;
    });
    if (result._tag !== "Success") {
      setHistoryError((current) => new Map(current).set(card.key, "Could not load earlier plans."));
      return;
    }
    setFullPlans((current) =>
      new Map(current).set(
        card.key,
        collectTaskPlans({ plans: result.value.plans, runs: result.value.runs }),
      ),
    );
  };
  const openPlan = (card: Pick<TaskCard, "key" | "title" | "environmentId" | "threadId">) => {
    setReader({
      key: card.key,
      title: card.title,
      environmentId: card.environmentId,
      threadId: card.threadId,
    });
    void loadHistory(card);
  };

  const placeCard = async (card: TaskCard, target: ManualTaskColumn | "auto") => {
    if (target === "auto") {
      setPlacements((current) => {
        if (!(card.key in current)) return current;
        const next = { ...current };
        delete next[card.key];
        return next;
      });
      return;
    }
    const plan = planTaskMove({
      card,
      target,
      canSettle:
        serverConfigs.get(card.environmentId)?.environment.capabilities.threadSettlement === true,
    });
    if (!plan) return;
    const ref = scopeThreadRef(card.environmentId, card.threadId);
    for (const effect of plan.effects) {
      const result =
        effect === "settle"
          ? await settleThread(ref)
          : effect === "unsettle"
            ? await unsettleThread(ref)
            : await unsnoozeThread(ref);
      if (result._tag !== "Success") {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: MOVE_FAILURE[effect],
            description: error instanceof Error ? error.message : "The move was not saved.",
          }),
        );
        return;
      }
    }
    setPlacements((current) => ({ ...current, [card.key]: plan.placement }));
  };

  const openCard = (card: TaskCard) => {
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(card.environmentId, card.threadId)),
    });
  };
  const readerCard =
    reader === null ? null : (counted.find((card) => card.key === reader.key) ?? null);
  const progressRows = visible.map((card) => {
    const stepProgress = taskThreadStepProgress(card, planFor(card));
    return {
      key: card.key,
      title: card.title,
      project: card.projectName,
      progress: stepProgress.progress,
      blockedReason: stepProgress.blockedReason,
    };
  });
  const plannedReaders = environments.map((environment) => ({
    environmentId: environment.environmentId,
    label: environment.label,
    displayUrl: environment.displayUrl,
    connection: environment.connection,
    primary: environment.environmentId === primaryEnvironmentId,
    serverConfig: environment.serverConfig,
  }));
  // Threads stay on the project server. This plan only chooses who reads the files.
  const planCheckout = (
    projectKey: string,
    projectName: string,
    owner: (typeof plannedReaders)[number]["environmentId"],
    cwd: string,
  ): PlannedTaskWorkspace => ({
    projectKey,
    projectName,
    cwd,
    ...planPlannedTaskRead({
      projectName,
      owner,
      environments: plannedReaders,
    }),
  });
  const plannedWorkspaces: PlannedTaskWorkspace[] =
    view === "planned"
      ? props.projectKey
        ? project && member
          ? [
              planCheckout(
                project.projectKey,
                project.displayName,
                member.environmentId,
                member.workspaceRoot,
              ),
            ]
          : []
        : groups.flatMap((group) => {
            if (projectFilter !== null && group.projectKey !== projectFilter) return [];
            const checkout = group.memberProjects[0];
            if (checkout === undefined) return [];
            return [
              planCheckout(
                group.projectKey,
                group.displayName,
                checkout.environmentId,
                checkout.workspaceRoot,
              ),
            ];
          })
      : [];
  const plannedState = usePlannedTaskSnapshots(plannedWorkspaces);
  // Opening text comes from threads the board already reads. Child threads link
  // from their title, branch, and worktree.
  const openingTexts = useThreadOpeningTexts(
    view === "planned"
      ? projectScoped.map((card) => ({
          environmentId: card.environmentId,
          threadId: card.threadId,
        }))
      : [],
  );
  const planned = buildPlannedBoard({
    active: view === "planned",
    snapshots: plannedState.snapshots,
    threads,
    groups,
    links: taskLinks,
    openingTexts,
    topic: topicFilter,
    showFirstCheckoutNote: props.projectKey == null,
  });
  const setPlannedLink = (threadKey: string, link: PlannedTaskLink | null | "auto") => {
    setTaskLinks((current) => {
      const next = { ...current };
      if (link === "auto") delete next[threadKey];
      else next[threadKey] = link;
      return next;
    });
  };

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        <WorkspacePageHeader electron={isElectron} />
        <div className="flex shrink-0 flex-col gap-3 pb-4 pl-(--workspace-gutter-start) pr-(--workspace-gutter-end)">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              {project ? project.displayName : "Tasks"}
            </h1>
            {props.projectKey ? (
              <Link
                to="/tasks"
                className="text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                All tasks
              </Link>
            ) : null}
            {project ? (
              <Link
                to="/project-graph/$projectKey"
                params={{ projectKey: project.projectKey }}
                className="text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                Graph
              </Link>
            ) : null}
          </div>
          {groups.length > 0 ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div
                role="group"
                aria-label="Board contents"
                className="flex shrink-0 gap-0.5 rounded-lg p-0.5 panel-well"
              >
                {(
                  [
                    ["threads", "Threads"],
                    ["steps", "Steps"],
                    ["planned", "Planned tasks"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={view === id}
                    onClick={() => setView(id)}
                    className={cn(
                      "flex h-7 cursor-pointer items-center rounded-md px-2.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                      view === id
                        ? "relative bg-(--panel-surface-active) text-foreground shadow-(--panel-drop) panel-edge"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {view === "planned" ? null : (
                <TaskCountBar
                  counts={counts}
                  selected={column}
                  onSelect={(next) => setFilters((current) => ({ ...current, column: next }))}
                />
              )}
              {props.projectKey ? (
                groups.length > 1 ? (
                  <FilterSelect
                    label="Project"
                    value={props.projectKey}
                    options={groups.map((group) => ({
                      value: group.projectKey,
                      label: group.displayName,
                    }))}
                    onChange={(value) =>
                      void navigate({
                        to: "/project-board/$projectKey",
                        params: { projectKey: value },
                      })
                    }
                  />
                ) : null
              ) : (
                <FilterSelect
                  label="Project"
                  value={projectFilter ?? ""}
                  options={[
                    { value: "", label: "All projects" },
                    ...groups.map((group) => ({
                      value: group.projectKey,
                      label: group.displayName,
                    })),
                  ]}
                  onChange={(value) =>
                    setFilters((current) => ({ ...current, projectKey: value || null }))
                  }
                />
              )}
              {view === "planned" ? (
                <FilterSelect
                  label="Topic"
                  value={planned.topic ?? ""}
                  options={[
                    { value: "", label: "All topics" },
                    ...planned.topics.map((topic) => ({ value: topic, label: topic })),
                  ]}
                  onChange={(value) => setTopicFilter(value.length > 0 ? value : null)}
                />
              ) : (
                <FilterSelect
                  label="Provider"
                  value={provider ?? ""}
                  options={[
                    { value: "", label: "All providers" },
                    ...providers.map((entry) => ({ value: entry, label: entry })),
                  ]}
                  onChange={(value) =>
                    setFilters((current) => ({ ...current, provider: value || null }))
                  }
                />
              )}
            </div>
          ) : null}
          {view === "planned" ? (
            <PlannedTaskProgress
              tasks={planned.tasks}
              pending={plannedState.pending}
              error={plannedState.error}
              notes={planned.notes}
              showProject={props.projectKey == null}
            />
          ) : visible.length > 0 ? (
            <TaskProgressPanel
              rows={progressRows}
              visibleThreads={visible.length}
              showProject={props.projectKey == null}
              onOpen={(key) => {
                const card = visible.find((entry) => entry.key === key);
                if (card) openCard(card);
              }}
            />
          ) : null}
        </div>
        {props.projectKey && !project ? (
          projectsReady ? (
            <Empty className="flex-1">
              <EmptyHeader>
                <EmptyTitle>Project not found</EmptyTitle>
                <EmptyDescription>Choose a project from the task board.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : null
        ) : (
          <div className="flex min-h-0 flex-1 flex-col xl:flex-row">
            {view === "planned" ? (
              <ScrollArea className="min-h-0 min-w-0 flex-1">
                <div className="flex min-h-full w-full min-w-0 flex-col pb-8 pl-(--workspace-gutter-start) pr-(--workspace-gutter-end) md:h-full">
                  <PlannedTaskBoard
                    tasks={planned.tasks}
                    threadsByTask={planned.threadsByTask}
                    linkChoices={planned.linkChoices}
                    showProject={props.projectKey == null}
                    onLink={setPlannedLink}
                    onOpenThread={(thread) =>
                      void navigate({
                        to: "/$environmentId/$threadId",
                        params: buildThreadRouteParams(
                          scopeThreadRef(thread.environmentId, thread.threadId),
                        ),
                      })
                    }
                  />
                </div>
              </ScrollArea>
            ) : cards.length === 0 ? (
              projectsReady ? (
                <Empty className="flex-1">
                  <EmptyHeader>
                    <EmptyTitle>No threads yet</EmptyTitle>
                    <EmptyDescription>
                      {project
                        ? "Threads in this project show up here."
                        : "Start a thread to see it on the board."}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <div className="min-h-0 flex-1" />
              )
            ) : (
              <ScrollArea className="min-h-0 min-w-0 flex-1">
                <div className="flex min-h-full w-full min-w-0 flex-col pb-8 pl-(--workspace-gutter-start) pr-(--workspace-gutter-end) md:h-full">
                  {visible.length === 0 ? (
                    <p className="py-6 text-sm text-muted-foreground">
                      No threads match these filters.
                    </p>
                  ) : view === "steps" ? (
                    <TaskStepBoard
                      steps={steps}
                      plans={planEntries}
                      linkProjects={props.projectKey == null}
                      onOpen={(step) =>
                        void navigate({
                          to: "/$environmentId/$threadId",
                          params: buildThreadRouteParams(
                            scopeThreadRef(step.environmentId, step.threadId),
                          ),
                        })
                      }
                      onOpenPlan={(key) => {
                        const card = visible.find((entry) => entry.key === key);
                        if (card) openPlan(card);
                      }}
                    />
                  ) : (
                    <TaskBoard
                      cards={visible}
                      activeColumn={column}
                      linkProjects={props.projectKey == null}
                      nowMs={Date.parse(now)}
                      planFor={planFor}
                      historyLoading={historyLoading}
                      historyError={historyError}
                      onLoadHistory={(card) => void loadHistory(card)}
                      onOpenPlan={openPlan}
                      onOpen={openCard}
                      onPlace={(card, target) => void placeCard(card, target)}
                    />
                  )}
                </div>
              </ScrollArea>
            )}
            {project && member ? (
              <aside className="flex max-h-[40vh] shrink-0 flex-col gap-3 overflow-auto border-t border-(--panel-edge) px-4 py-3 xl:max-h-none xl:w-96 xl:border-t-0 xl:border-l">
                {project.isScratch || gitEnvironmentId === null ? (
                  <p className="text-sm text-muted-foreground">
                    Scratch threads have no repository history.
                  </p>
                ) : (
                  <ProjectCommitList
                    environmentId={gitEnvironmentId}
                    cwd={member.workspaceRoot}
                    controls={
                      project.memberProjects.length > 1 ? (
                        <FilterSelect
                          label="Checkout"
                          value={`${member.environmentId}:${member.id}`}
                          options={project.memberProjects.map((entry) => ({
                            value: `${entry.environmentId}:${entry.id}`,
                            label: entry.environmentLabel ?? entry.workspaceRoot,
                          }))}
                          onChange={(value) =>
                            void navigate({
                              to: "/project-board/$projectKey",
                              params: { projectKey: project.projectKey },
                              search: { checkout: value },
                            })
                          }
                        />
                      ) : null
                    }
                  />
                )}
              </aside>
            ) : null}
          </div>
        )}
      </div>
      <TaskPlanDialog
        open={reader !== null}
        title={reader?.title ?? "Plan"}
        environmentId={reader?.environmentId ?? null}
        plans={readerCard ? planFor(readerCard) : null}
        historyLoading={reader !== null && historyLoading.has(reader.key)}
        historyError={reader ? (historyError.get(reader.key) ?? null) : null}
        onOpenChange={(open) => {
          if (!open) setReader(null);
        }}
        onLoadHistory={() => {
          if (readerCard) void loadHistory(readerCard);
        }}
      />
    </SidebarInset>
  );
}

function TaskCountBar(props: {
  readonly counts: Record<TaskColumnId, number>;
  readonly selected: TaskColumnId | null;
  readonly onSelect: (column: TaskColumnId | null) => void;
}) {
  const total = TASK_COLUMNS.reduce((sum, column) => sum + props.counts[column.id], 0);
  const options: Array<{ id: TaskColumnId | null; label: string; count: number }> = [
    { id: null, label: "All", count: total },
    ...TASK_COLUMNS.map((column) => ({
      id: column.id,
      label: column.label,
      count: props.counts[column.id],
    })),
  ];
  return (
    <div
      role="group"
      aria-label="Task status"
      className="flex min-w-0 max-w-full flex-wrap gap-0.5 rounded-lg p-0.5 panel-well"
    >
      {options.map((option) => {
        const pressed = props.selected === option.id;
        return (
          <button
            key={option.label}
            type="button"
            aria-pressed={pressed}
            onClick={() => props.onSelect(option.id)}
            className={cn(
              "flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-xs font-medium outline-none squircle transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              pressed
                ? "relative bg-(--panel-surface-active) text-foreground shadow-(--panel-drop) panel-edge"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
            <span className="text-muted-foreground tabular-nums">{option.count}</span>
          </button>
        );
      })}
    </div>
  );
}

function FilterSelect(props: {
  readonly label: string;
  readonly value: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly onChange: (value: string) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span>{props.label}</span>
      <select
        aria-label={props.label}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        className="h-7 max-w-52 cursor-pointer truncate rounded-md bg-transparent px-1 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        {props.options.map((option) => (
          <option key={option.value || "all"} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function buildPlannedBoard(input: {
  readonly active: boolean;
  readonly snapshots: readonly PlannedTaskLoaded[];
  readonly threads: readonly EnvironmentThreadShell[];
  readonly groups: readonly SidebarProjectSnapshot[];
  readonly links: Readonly<Record<string, PlannedTaskLink | null>>;
  readonly openingTexts: ReadonlyMap<string, string>;
  readonly topic: string | null;
  readonly showFirstCheckoutNote: boolean;
}): {
  readonly tasks: readonly PlannedBoardTask[];
  readonly topics: readonly string[];
  readonly topic: string | null;
  readonly notes: readonly string[];
  readonly threadsByTask: ReadonlyMap<string, readonly PlannedBoardThread[]>;
  readonly linkChoices: readonly PlannedBoardThread[];
} {
  const empty = {
    tasks: [],
    topics: [],
    topic: null,
    notes: [],
    threadsByTask: new Map<string, readonly PlannedBoardThread[]>(),
    linkChoices: [],
  };
  if (!input.active) return empty;
  const all = input.snapshots.flatMap((entry) =>
    entry.snapshot.tasks.map((task) => ({
      ...task,
      projectKey: entry.projectKey,
      projectName: entry.projectName,
      environmentId: entry.environmentId,
      cwd: entry.cwd,
    })),
  );
  const topics = [...new Set(all.map((task) => task.topic))].sort((left, right) =>
    left.localeCompare(right),
  );
  const topic = input.topic !== null && topics.includes(input.topic) ? input.topic : null;
  const tasks = topic === null ? all : all.filter((task) => task.topic === topic);
  const projectByMember = new Map<string, string>();
  for (const group of input.groups) {
    for (const member of group.memberProjects) {
      projectByMember.set(`${member.environmentId}:${member.id}`, group.projectKey);
    }
  }
  const relevant = new Set(input.snapshots.map((entry) => entry.projectKey));
  const linkThreads: PlannedLinkThread[] = [];
  const linkChoices: PlannedBoardThread[] = [];
  for (const thread of input.threads) {
    if (thread.deletedAt !== null) continue;
    const projectKey = projectByMember.get(`${thread.environmentId}:${thread.projectId}`);
    if (projectKey === undefined || !relevant.has(projectKey)) continue;
    const key = `${thread.environmentId}:${thread.id}`;
    linkThreads.push({
      key,
      projectKey,
      title: thread.title,
      branch: thread.branch,
      worktreePath: thread.worktreePath,
      openingText: input.openingTexts.get(key) ?? null,
    });
    linkChoices.push({
      key,
      projectKey,
      title: thread.title,
      statusLabel: resolveThreadStatusPill({ thread })?.label ?? "Idle",
      child: thread.lineage.parentThreadId !== null,
      manual: input.links[key] != null,
      environmentId: thread.environmentId,
      threadId: thread.id,
    });
  }
  const linked = linkThreadsToPlannedTasks({
    tasks: all,
    threads: linkThreads,
    manual: input.links,
  });
  const choiceByKey = new Map(linkChoices.map((thread) => [thread.key, thread]));
  const threadsByTask = new Map<string, readonly PlannedBoardThread[]>();
  for (const [key, threadKeys] of linked) {
    const rows: PlannedBoardThread[] = [];
    for (const threadKey of threadKeys) {
      const thread = choiceByKey.get(threadKey);
      if (thread !== undefined) rows.push(thread);
    }
    threadsByTask.set(key, rows);
  }
  const notes: string[] = [];
  for (const entry of input.snapshots) {
    if (entry.sourceNote.length > 0) notes.push(entry.sourceNote);
  }
  const globs = [...new Set(input.snapshots.map((entry) => entry.snapshot.issuesGlob))];
  const glob = globs.length === 1 ? globs[0] : undefined;
  if (glob !== undefined) notes.push(`Reading ${glob}.`);
  for (const entry of input.snapshots) {
    if (entry.snapshot.warning !== null)
      notes.push(`${entry.projectName}: ${entry.snapshot.warning}`);
  }
  if (input.showFirstCheckoutNote && input.snapshots.length > 0) {
    notes.push("Each project is read from its first checkout.");
  }
  return { tasks, topics, topic, notes, threadsByTask, linkChoices };
}
