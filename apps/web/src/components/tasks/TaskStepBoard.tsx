import { Link } from "@tanstack/react-router";

import { cn } from "../../lib/utils";
import {
  formatStepDuration,
  TASK_STEP_COLUMNS,
  type TaskStepCard,
  type TaskStepColumnId,
} from "./taskPlanSummary";

const STEP_DOT: Record<TaskStepColumnId, string> = {
  pending: "bg-muted-foreground/70",
  running: "bg-sky-500",
  completed: "bg-emerald-500",
};

export interface TaskPlanEntry {
  readonly key: string;
  readonly title: string;
  readonly detail: string;
}

export function TaskStepBoard(props: {
  readonly steps: readonly TaskStepCard[];
  readonly plans: readonly TaskPlanEntry[];
  readonly linkProjects: boolean;
  readonly onOpen: (step: TaskStepCard) => void;
  readonly onOpenPlan: (threadKey: string) => void;
}) {
  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col gap-3">
      {props.plans.length > 0 ? (
        <section aria-label="Plans" className="flex flex-col gap-2">
          <h2 className="text-xs font-medium text-foreground">Plans</h2>
          <div className="flex flex-col gap-2 md:flex-row md:flex-wrap">
            {props.plans.map((plan) => (
              <button
                key={plan.key}
                type="button"
                onClick={() => props.onOpenPlan(plan.key)}
                className="flex min-w-0 cursor-pointer flex-col gap-0.5 rounded-xl bg-(--row-surface) px-3 py-2 text-left squircle outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:max-w-80"
              >
                <span className="truncate text-sm font-medium text-foreground">{plan.title}</span>
                <span className="truncate text-xs text-muted-foreground">{plan.detail}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
      <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col gap-3 md:flex-row md:overflow-x-auto md:overflow-y-hidden">
        {TASK_STEP_COLUMNS.map((column) => {
          const steps = props.steps.filter((step) => step.column === column.id);
          return (
            <section
              key={column.id}
              aria-label={column.label}
              className="flex min-h-48 w-full min-w-0 flex-col rounded-xl panel-well md:h-full md:min-w-48 md:flex-1 md:basis-0"
            >
              <header className="flex items-center gap-2 px-3 py-2">
                <span aria-hidden className={cn("size-1.5 rounded-full", STEP_DOT[column.id])} />
                <h2 className="text-xs font-medium text-foreground">{column.label}</h2>
                <span className="text-xs text-muted-foreground tabular-nums">{steps.length}</span>
              </header>
              <div className="flex flex-col gap-2 px-2 pb-2 md:min-h-0 md:flex-1 md:overflow-y-auto">
                {steps.length === 0 ? (
                  <p className="px-1 py-2 text-xs text-muted-foreground">Nothing here.</p>
                ) : (
                  steps.map((step) => (
                    <TaskStepCardView
                      key={step.key}
                      step={step}
                      linkProjects={props.linkProjects}
                      onOpen={props.onOpen}
                      onOpenPlan={props.onOpenPlan}
                    />
                  ))
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function TaskStepCardView(props: {
  readonly step: TaskStepCard;
  readonly linkProjects: boolean;
  readonly onOpen: (step: TaskStepCard) => void;
  readonly onOpenPlan: (threadKey: string) => void;
}) {
  const { step } = props;
  return (
    <article className="rounded-xl bg-(--row-surface) squircle">
      <button
        type="button"
        onClick={() => props.onOpen(step)}
        className="flex w-full cursor-pointer flex-col gap-1 px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <span className="truncate text-sm font-medium text-foreground">{step.text}</span>
        <span className="truncate text-xs text-muted-foreground">{step.threadTitle}</span>
        {!props.linkProjects || step.durationMs !== null ? (
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            {props.linkProjects ? null : (
              <span className="min-w-0 truncate">{step.projectName}</span>
            )}
            {step.durationMs !== null ? (
              <span className="shrink-0 tabular-nums">{formatStepDuration(step.durationMs)}</span>
            ) : null}
          </span>
        ) : null}
      </button>
      <div className="px-3 pb-2">
        <button
          type="button"
          onClick={() => props.onOpenPlan(step.threadKey)}
          className="cursor-pointer text-xs text-muted-foreground underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          Plan
        </button>
      </div>
      {props.linkProjects && step.projectKey ? (
        <div className="px-3 pb-2">
          <Link
            to="/project-board/$projectKey"
            params={{ projectKey: step.projectKey }}
            className="block truncate text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            {step.projectName}
          </Link>
        </div>
      ) : null}
    </article>
  );
}
