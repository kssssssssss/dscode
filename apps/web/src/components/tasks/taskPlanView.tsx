import type { EnvironmentId } from "@t3tools/contracts";
import { lazy, Suspense, useState } from "react";

import { cn } from "../../lib/utils";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import {
  formatStepDuration,
  planPreviewLines,
  proposedPlanLabel,
  type TaskPlanVersion,
  type TaskProposedSummary,
  type TaskThreadPlans,
  type TaskTodoStep,
  type TaskTodoSummary,
} from "./taskPlanSummary";

const PlanMarkdown = lazy(() => import("../ChatMarkdown"));

const STEP_DOT = {
  pending: "bg-muted-foreground/70",
  running: "bg-sky-500",
  completed: "bg-emerald-500",
} as const;

function PlanMarkdownBody(props: {
  readonly markdown: string;
  readonly environmentId: EnvironmentId;
}) {
  return (
    <Suspense fallback={<p className="text-xs text-muted-foreground">Opening plan…</p>}>
      <PlanMarkdown
        text={props.markdown}
        cwd={undefined}
        environmentId={props.environmentId}
        isStreaming={false}
        headingLevelOffset={3}
      />
    </Suspense>
  );
}

function StepList(props: { readonly steps: readonly TaskTodoStep[] }) {
  return (
    <ol className="flex flex-col gap-1">
      {props.steps.map((step) => (
        <li key={step.id} className="flex min-w-0 items-baseline gap-2 text-xs">
          <span
            aria-hidden
            className={cn("size-1.5 shrink-0 rounded-full", STEP_DOT[step.status])}
          />
          <span className="sr-only">{step.status}</span>
          <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-foreground/90">
            {step.text}
          </span>
          {step.durationMs !== null ? (
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {formatStepDuration(step.durationMs)}
            </span>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function TodoBody(props: { readonly todo: TaskTodoSummary }) {
  return (
    <div className="flex flex-col gap-2">
      {props.todo.explanation ? (
        <p className="whitespace-pre-wrap break-words text-xs text-foreground/90">
          {props.todo.explanation}
        </p>
      ) : null}
      <StepList steps={props.todo.steps} />
    </div>
  );
}

function VersionBody(props: {
  readonly version: TaskPlanVersion;
  readonly environmentId: EnvironmentId;
}) {
  if (props.version.stripped) {
    return (
      <p className="text-xs text-muted-foreground">This version was trimmed in the snapshot.</p>
    );
  }
  if (props.version.kind === "proposed_plan") {
    return props.version.markdown ? (
      <PlanMarkdownBody markdown={props.version.markdown} environmentId={props.environmentId} />
    ) : (
      <p className="text-xs text-muted-foreground">This plan has no text.</p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {props.version.explanation ? (
        <p className="whitespace-pre-wrap break-words text-xs text-foreground/90">
          {props.version.explanation}
        </p>
      ) : null}
      {props.version.steps.length > 0 ? <StepList steps={props.version.steps} /> : null}
    </div>
  );
}

function PreviousPlans(props: {
  readonly plans: TaskThreadPlans;
  readonly open: boolean;
  readonly loading: boolean;
  readonly error: string | null;
  readonly environmentId: EnvironmentId;
  readonly onToggle: () => void;
}) {
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(new Set());
  const count = props.plans.previous.length;
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        aria-expanded={props.open}
        onClick={props.onToggle}
        className="cursor-pointer text-left text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        {props.open ? "▾" : "▸"} Previous plans{count > 0 ? ` (${count})` : ""}
      </button>
      {props.open ? (
        props.loading && count === 0 ? (
          <p className="text-xs text-muted-foreground">Loading previous plans…</p>
        ) : props.error && count === 0 ? (
          <p className="text-xs text-muted-foreground">{props.error}</p>
        ) : count === 0 ? (
          <p className="text-xs text-muted-foreground">No earlier plans.</p>
        ) : (
          <ol className="flex flex-col gap-1">
            {props.plans.previous.map((version) => {
              const expanded = openIds.has(version.id);
              const label =
                version.kind === "proposed_plan"
                  ? proposedPlanLabel(version.status)
                  : `Todo list · ${version.steps.filter((step) => step.status === "completed").length}/${version.steps.length}`;
              return (
                <li key={version.id}>
                  <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() =>
                      setOpenIds((current) => {
                        const next = new Set(current);
                        if (next.has(version.id)) next.delete(version.id);
                        else next.add(version.id);
                        return next;
                      })
                    }
                    className="cursor-pointer text-left text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    {expanded ? "▾" : "▸"} {label}
                  </button>
                  {expanded ? (
                    <div className="max-h-64 overflow-y-auto pt-1">
                      <VersionBody version={version} environmentId={props.environmentId} />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )
      ) : null}
    </div>
  );
}

export function TaskPlanSection(props: {
  readonly plan: TaskThreadPlans | null;
  readonly expanded: boolean;
  readonly environmentId: EnvironmentId;
  readonly historyLoading: boolean;
  readonly historyError: string | null;
  readonly onToggle: () => void;
  readonly onLoadHistory: () => void;
  readonly onOpenPlan: () => void;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const { plan } = props;
  if (
    plan === null ||
    (plan.todo === null && plan.proposed === null && plan.previous.length === 0)
  ) {
    return null;
  }
  const preview = plan.proposed ? planPreviewLines(plan.proposed.markdown) : [];
  const toggleHistory = () => {
    setHistoryOpen((open) => {
      if (!open) props.onLoadHistory();
      return !open;
    });
  };
  return (
    <div className="flex flex-col gap-1.5 px-3 pb-2">
      {plan.todo ? (
        <div>
          <button
            type="button"
            aria-expanded={props.expanded}
            onClick={props.onToggle}
            className="flex w-full min-w-0 cursor-pointer items-baseline gap-1.5 text-left text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <span aria-hidden className="shrink-0 text-foreground/60">
              {props.expanded ? "▾" : "▸"}
            </span>
            <span className="shrink-0 tabular-nums text-foreground/80">
              {plan.todo.completed}/{plan.todo.total}
            </span>
            {plan.todo.runningText ? (
              <span className="min-w-0 flex-1 truncate">{plan.todo.runningText}</span>
            ) : null}
          </button>
          {props.expanded ? (
            <div className="max-h-64 overflow-y-auto pt-1">
              <TodoBody todo={plan.todo} />
            </div>
          ) : null}
        </div>
      ) : null}
      {plan.proposed ? (
        <ProposedSection
          proposed={plan.proposed}
          preview={preview}
          environmentId={props.environmentId}
          onOpenPlan={props.onOpenPlan}
        />
      ) : null}
      <PreviousPlans
        plans={plan}
        open={historyOpen}
        loading={props.historyLoading}
        error={props.historyError}
        environmentId={props.environmentId}
        onToggle={toggleHistory}
      />
    </div>
  );
}

function ProposedSection(props: {
  readonly proposed: TaskProposedSummary;
  readonly preview: readonly string[];
  readonly environmentId: EnvironmentId;
  readonly onOpenPlan: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const label = proposedPlanLabel(props.proposed.status);
  return (
    <div>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((open) => !open)}
        className="flex w-full min-w-0 cursor-pointer items-baseline gap-1.5 text-left text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <span aria-hidden className="shrink-0 text-foreground/60">
          {expanded ? "▾" : "▸"}
        </span>
        <span className="shrink-0 text-foreground/80">Plan</span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </button>
      {expanded ? (
        <div className="flex flex-col gap-1 pt-1">
          <div className="max-h-64 overflow-y-auto">
            {props.proposed.markdown.length > 0 ? (
              <PlanMarkdownBody
                markdown={props.proposed.markdown}
                environmentId={props.environmentId}
              />
            ) : (
              <p className="text-xs text-muted-foreground">
                {props.proposed.stripped ? "This plan was trimmed in the snapshot." : label}
              </p>
            )}
          </div>
          {props.proposed.markdown.length > 0 ? (
            <button
              type="button"
              onClick={props.onOpenPlan}
              className="cursor-pointer self-start text-xs text-muted-foreground underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              Open plan
            </button>
          ) : null}
        </div>
      ) : props.preview.length > 0 ? (
        <p className="line-clamp-3 whitespace-pre-wrap pt-1 text-xs text-muted-foreground">
          {props.preview.join("\n")}
        </p>
      ) : null}
    </div>
  );
}

export function TaskPlanDialog(props: {
  readonly open: boolean;
  readonly title: string;
  readonly environmentId: EnvironmentId | null;
  readonly plans: TaskThreadPlans | null;
  readonly historyLoading: boolean;
  readonly historyError: string | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onLoadHistory: () => void;
}) {
  const [historyOpen, setHistoryOpen] = useState(true);
  const plans = props.plans;
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
          {plans?.proposed ? (
            <DialogDescription>{proposedPlanLabel(plans.proposed.status)}</DialogDescription>
          ) : null}
        </DialogHeader>
        <DialogPanel>
          {plans?.proposed && plans.proposed.markdown.length > 0 && props.environmentId ? (
            <PlanMarkdownBody
              markdown={plans.proposed.markdown}
              environmentId={props.environmentId}
            />
          ) : null}
          {plans?.todo ? <TodoBody todo={plans.todo} /> : null}
          {plans && props.environmentId ? (
            <PreviousPlans
              plans={plans}
              open={historyOpen}
              loading={props.historyLoading}
              error={props.historyError}
              environmentId={props.environmentId}
              onToggle={() =>
                setHistoryOpen((open) => {
                  if (!open) props.onLoadHistory();
                  return !open;
                })
              }
            />
          ) : null}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
