import {
  DndContext,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DraggableSyntheticListeners,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Link } from "@tanstack/react-router";
import { useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

import { cn } from "../../lib/utils";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import {
  dropTargetColumn,
  isManualTaskColumn,
  TASK_COLUMNS,
  taskCardDragId,
  taskCardKeyFromDragId,
  taskColumnDropId,
  type ManualTaskColumn,
  type TaskCard,
  type TaskColumnId,
} from "./taskBoardModel";
import {
  formatStepDuration,
  proposedPlanLabel,
  type TaskPlanSummary,
  type TaskStepColumnId,
} from "./taskPlanSummary";

const COLUMN_DOT: Record<TaskColumnId, string> = {
  todo: "bg-muted-foreground/70",
  progress: "bg-sky-500",
  review: "bg-amber-500",
  blocked: "bg-red-500",
  done: "bg-emerald-500",
};

export function TaskBoard(props: {
  readonly cards: readonly TaskCard[];
  readonly activeColumn: TaskColumnId | null;
  readonly linkProjects: boolean;
  readonly nowMs: number;
  readonly planFor: (card: TaskCard) => TaskPlanSummary | null;
  readonly onOpen: (card: TaskCard) => void;
  readonly onPlace: (card: TaskCard, target: ManualTaskColumn | "auto") => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
  );
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [overColumn, setOverColumn] = useState<TaskColumnId | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const toggleExpanded = (key: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const columns =
    props.activeColumn === null
      ? TASK_COLUMNS
      : TASK_COLUMNS.filter((column) => column.id === props.activeColumn);
  const onDragEnd = (event: DragEndEvent) => {
    setDraggingKey(null);
    const key = taskCardKeyFromDragId(String(event.active.id));
    const overId = event.over ? String(event.over.id) : null;
    if (key === null || overId === null) return;
    const card = props.cards.find((entry) => entry.key === key);
    const target = dropTargetColumn(overId, props.cards);
    if (!card || target === null || !isManualTaskColumn(target)) return;
    props.onPlace(card, target);
  };
  const onDragOver = (event: DragOverEvent) => {
    const overId = event.over ? String(event.over.id) : null;
    setOverColumn(overId === null ? null : dropTargetColumn(overId, props.cards));
  };

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(event) => {
        setOverColumn(null);
        setDraggingKey(taskCardKeyFromDragId(String(event.active.id)));
      }}
      onDragOver={onDragOver}
      onDragCancel={() => {
        setDraggingKey(null);
        setOverColumn(null);
      }}
      onDragEnd={(event) => {
        setOverColumn(null);
        onDragEnd(event);
      }}
    >
      <div
        className={cn(
          "flex min-h-0 w-full min-w-0 flex-1 flex-col gap-3",
          columns.length > 1 && "md:flex-row md:overflow-x-auto md:overflow-y-hidden",
        )}
      >
        {columns.map((column) => (
          <TaskColumn
            key={column.id}
            columnId={column.id}
            label={column.label}
            manual={column.manual}
            stretched={columns.length === 1}
            dragging={draggingKey !== null}
            over={overColumn === column.id}
            cards={props.cards.filter((card) => card.column === column.id)}
            linkProjects={props.linkProjects}
            nowMs={props.nowMs}
            planFor={props.planFor}
            expanded={expanded}
            onTogglePlan={toggleExpanded}
            onOpen={props.onOpen}
            onPlace={props.onPlace}
          />
        ))}
      </div>
    </DndContext>
  );
}

function TaskColumn(props: {
  readonly columnId: TaskColumnId;
  readonly label: string;
  readonly manual: boolean;
  readonly stretched: boolean;
  readonly dragging: boolean;
  readonly over: boolean;
  readonly cards: readonly TaskCard[];
  readonly linkProjects: boolean;
  readonly nowMs: number;
  readonly planFor: (card: TaskCard) => TaskPlanSummary | null;
  readonly expanded: ReadonlySet<string>;
  readonly onTogglePlan: (key: string) => void;
  readonly onOpen: (card: TaskCard) => void;
  readonly onPlace: (card: TaskCard, target: ManualTaskColumn | "auto") => void;
}) {
  const { setNodeRef } = useDroppable({
    id: taskColumnDropId(props.columnId),
    disabled: !props.manual,
  });
  return (
    <section
      ref={setNodeRef}
      aria-label={props.label}
      className={cn(
        "flex min-h-48 w-full min-w-0 flex-col rounded-xl panel-well",
        !props.stretched && "md:h-full md:min-w-48 md:flex-1 md:basis-0",
        props.over && props.manual && "ring-2 ring-inset ring-ring",
      )}
    >
      <header className="flex items-center gap-2 px-3 py-2">
        <span aria-hidden className={cn("size-1.5 rounded-full", COLUMN_DOT[props.columnId])} />
        <h2 className="text-xs font-medium text-foreground">{props.label}</h2>
        <span className="text-xs text-muted-foreground tabular-nums">{props.cards.length}</span>
        {props.dragging && props.manual ? (
          <span className="ml-auto text-2xs text-muted-foreground">Drop</span>
        ) : null}
      </header>
      <div
        className={cn(
          "flex flex-col gap-2 px-2 pb-2",
          !props.stretched && "md:min-h-0 md:flex-1 md:overflow-y-auto",
        )}
      >
        {props.cards.length === 0 ? (
          <p className="px-1 py-3 text-xs text-muted-foreground">Nothing here.</p>
        ) : (
          props.cards.map((card) => (
            <TaskCardView
              key={card.key}
              card={card}
              linkProjects={props.linkProjects}
              nowMs={props.nowMs}
              plan={props.planFor(card)}
              expanded={props.expanded.has(card.key)}
              onTogglePlan={props.onTogglePlan}
              onOpen={props.onOpen}
              onPlace={props.onPlace}
            />
          ))
        )}
      </div>
    </section>
  );
}

function TaskCardView(props: {
  readonly card: TaskCard;
  readonly linkProjects: boolean;
  readonly nowMs: number;
  readonly plan: TaskPlanSummary | null;
  readonly expanded: boolean;
  readonly onTogglePlan: (key: string) => void;
  readonly onOpen: (card: TaskCard) => void;
  readonly onPlace: (card: TaskCard, target: ManualTaskColumn | "auto") => void;
}) {
  const { card } = props;
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: taskCardDragId(card.key),
    disabled: card.locked,
  });
  const activity =
    card.activityMs === null
      ? null
      : formatRelativeTimeLabel(new Date(card.activityMs).toISOString(), props.nowMs);
  const open = () => props.onOpen(card);
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const keyDown = listeners?.onKeyDown;
    if (typeof keyDown === "function") keyDown(event);
    if (event.key === "Enter") {
      event.preventDefault();
      open();
    }
  };

  return (
    <article
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        zIndex: isDragging ? 20 : undefined,
      }}
      className={cn("rounded-xl bg-(--row-surface) squircle", isDragging && "opacity-80 shadow-lg")}
    >
      <div
        {...attributes}
        {...listenersWithoutKeyDown(listeners)}
        onKeyDown={onKeyDown}
        onClick={open}
        className={cn(
          "flex flex-col gap-1 px-3 pt-2.5 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          card.locked ? "cursor-pointer" : "cursor-grab active:cursor-grabbing",
          props.linkProjects && card.projectKey ? "pb-1" : "pb-2.5",
        )}
      >
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
            {card.title}
          </span>
          {activity ? (
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{activity}</span>
          ) : null}
        </div>
        {props.linkProjects && card.projectKey ? null : (
          <span className="truncate text-xs text-muted-foreground">{card.projectName}</span>
        )}
        <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span className="truncate">{card.provider}</span>
          <span aria-hidden>·</span>
          <span className="shrink-0 text-foreground/80">{card.statusLabel}</span>
        </div>
        {card.branch ? (
          <span className="truncate font-mono text-2xs text-muted-foreground">{card.branch}</span>
        ) : null}
      </div>
      {props.linkProjects && card.projectKey ? (
        <div className="px-3 pb-2">
          <Link
            to="/project-board/$projectKey"
            params={{ projectKey: card.projectKey }}
            className="block truncate text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            {card.projectName}
          </Link>
        </div>
      ) : null}
      <TaskPlanDetails
        cardKey={card.key}
        plan={props.plan}
        expanded={props.expanded}
        onToggle={props.onTogglePlan}
      />
      {card.locked ? null : (
        <div className="px-3 pb-2">
          <label className="sr-only" htmlFor={`move-${card.key}`}>
            Move {card.title}
          </label>
          <select
            id={`move-${card.key}`}
            aria-label={`Move ${card.title}`}
            value=""
            onChange={(event) => {
              const value = event.target.value;
              if (value === "auto") {
                props.onPlace(card, "auto");
                return;
              }
              if (isManualTaskColumn(value)) {
                props.onPlace(card, value);
              }
            }}
            className="h-7 w-full cursor-pointer rounded-md bg-transparent text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <option value="">Move to…</option>
            {TASK_COLUMNS.filter((column) => column.manual && column.id !== card.column).map(
              (column) => (
                <option key={column.id} value={column.id}>
                  {column.label}
                </option>
              ),
            )}
            {card.placement !== null ? <option value="auto">Follow status</option> : null}
          </select>
        </div>
      )}
    </article>
  );
}

const STEP_DOT: Record<TaskStepColumnId, string> = {
  pending: "bg-muted-foreground/70",
  running: "bg-sky-500",
  completed: "bg-emerald-500",
};

function TaskPlanDetails(props: {
  readonly cardKey: string;
  readonly plan: TaskPlanSummary | null;
  readonly expanded: boolean;
  readonly onToggle: (key: string) => void;
}) {
  const { plan } = props;
  if (plan === null) return null;
  if (plan.kind === "proposed_plan") {
    return (
      <p className="px-3 pb-2 text-xs text-muted-foreground">{proposedPlanLabel(plan.status)}</p>
    );
  }
  return (
    <div className="px-3 pb-2">
      <button
        type="button"
        aria-expanded={props.expanded}
        onClick={() => props.onToggle(props.cardKey)}
        className="flex w-full min-w-0 cursor-pointer items-baseline gap-1.5 text-left text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <span aria-hidden className="shrink-0 text-foreground/60">
          {props.expanded ? "▾" : "▸"}
        </span>
        <span className="shrink-0 tabular-nums text-foreground/80">
          {plan.completed}/{plan.total}
        </span>
        {plan.runningText ? (
          <span className="min-w-0 flex-1 truncate">{plan.runningText}</span>
        ) : null}
      </button>
      {props.expanded ? (
        <ol className="mt-1 flex flex-col gap-1">
          {plan.steps.map((step) => (
            <li key={step.id} className="flex min-w-0 items-baseline gap-2 text-xs">
              <span
                aria-hidden
                className={cn("size-1.5 shrink-0 rounded-full", STEP_DOT[step.status])}
              />
              <span className="sr-only">{step.status}</span>
              <span className="min-w-0 flex-1 truncate text-foreground/90">{step.text}</span>
              {step.durationMs !== null ? (
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {formatStepDuration(step.durationMs)}
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

function listenersWithoutKeyDown(
  listeners: DraggableSyntheticListeners | undefined,
): DraggableSyntheticListeners | undefined {
  if (!listeners) return listeners;
  const { onKeyDown: _onKeyDown, ...rest } = listeners;
  return rest;
}
