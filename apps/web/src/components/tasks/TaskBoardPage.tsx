import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { resolveProjectGraphSource } from "@t3tools/client-runtime/state/project-graph-source";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { Link, useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";

import { isElectron } from "../../env";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useNowMinute } from "../../hooks/useNowMinute";
import { useThreadActions } from "../../hooks/useThreadActions";
import { cn } from "../../lib/utils";
import { buildThreadRouteParams } from "../../threadRoutes";
import {
  useAllEnvironmentProjectSnapshotsReady,
  useDelegatedUnderParent,
  useServerConfigs,
  useThreadShells,
} from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { ScrollArea } from "../ui/scroll-area";
import { SidebarInset } from "../ui/sidebar";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { useSettingsProjectGroups } from "../settings/useSettingsProjectGroups";
import { ProjectCommitList } from "./ProjectCommitList";
import { TaskBoard } from "./TaskBoard";
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
} from "./taskBoard";

const PLACEMENTS_KEY = "t3code:tasks:placements";
const FILTERS_KEY = "t3code:tasks:filters";
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
  const nowMinute = useNowMinute();
  const now = `${nowMinute}:00.000Z`;
  const { settleThread, unsettleThread, unsnoozeThread } = useThreadActions();
  const [placements, setPlacements] = useLocalStorage(
    PLACEMENTS_KEY,
    EMPTY_PLACEMENTS,
    TaskPlacementsSchema,
  );
  const [filters, setFilters] = useLocalStorage(FILTERS_KEY, EMPTY_FILTERS, TaskFiltersSchema);
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
              <TaskCountBar
                counts={counts}
                selected={column}
                onSelect={(next) => setFilters((current) => ({ ...current, column: next }))}
              />
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
            </div>
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
            {cards.length === 0 ? (
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
                  ) : (
                    <TaskBoard
                      cards={visible}
                      activeColumn={column}
                      linkProjects={props.projectKey == null}
                      nowMs={Date.parse(now)}
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
