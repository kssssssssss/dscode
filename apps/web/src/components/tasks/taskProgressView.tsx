import { useState } from "react";

import { cn } from "../../lib/utils";
import { Tooltip, TooltipPopup, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import {
  compareTaskProgressPercent,
  describeTaskStepProgress,
  sumTaskStepProgress,
  type TaskStepProgress,
} from "./taskProgress";

const SEGMENTS = [
  { key: "completed", label: "Done", className: "bg-emerald-700 dark:bg-emerald-400" },
  { key: "running", label: "Running", className: "bg-sky-700 dark:bg-sky-400" },
  { key: "pending", label: "Pending", className: "bg-zinc-500 dark:bg-zinc-300" },
  { key: "blocked", label: "Blocked", className: "bg-amber-700 dark:bg-amber-400" },
] as const;

export interface TaskProgressRow {
  readonly key: string;
  readonly title: string;
  readonly project: string;
  readonly progress: TaskStepProgress;
  readonly blockedReason: string | null;
}

function segmentCount(progress: TaskStepProgress, key: (typeof SEGMENTS)[number]["key"]): number {
  return progress[key];
}

export function TaskProgressMeter(props: {
  readonly progress: TaskStepProgress;
  readonly blockedReason: string | null;
}) {
  const { progress, blockedReason } = props;
  if (progress.planned === 0 || progress.percent === null) return null;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div
        role="img"
        aria-label={describeTaskStepProgress(progress, blockedReason)}
        className="flex h-1.5 w-full overflow-hidden rounded-full bg-foreground/10"
      >
        {SEGMENTS.map((segment) => {
          const count = segmentCount(progress, segment.key);
          if (count === 0) return null;
          return (
            <div
              key={segment.key}
              className={cn("h-full min-w-0 basis-0", segment.className)}
              style={{ flexGrow: count }}
            />
          );
        })}
      </div>
      <p
        aria-hidden
        className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs text-muted-foreground tabular-nums"
      >
        <span className="font-medium text-foreground">{progress.percent}%</span>
        <span>{progress.completed} done</span>
        <span>{progress.running} running</span>
        <span>{progress.pending} pending</span>
        <BlockedCount count={progress.blocked} reason={blockedReason} />
      </p>
    </div>
  );
}

function BlockedCount(props: { readonly count: number; readonly reason: string | null }) {
  if (props.reason === null) return <span>{props.count} blocked</span>;
  return (
    <TooltipProvider delay={150} closeDelay={0} timeout={400}>
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              className="cursor-help underline decoration-dotted underline-offset-2"
              aria-label={`${props.count} blocked. ${props.reason}`}
            />
          }
        >
          {props.count} blocked
        </TooltipTrigger>
        <TooltipPopup>{props.reason}</TooltipPopup>
      </Tooltip>
    </TooltipProvider>
  );
}

export function TaskProgressPanel(props: {
  readonly rows: readonly TaskProgressRow[];
  readonly visibleThreads: number;
  readonly showProject: boolean;
  readonly onOpen: (key: string) => void;
}) {
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const listed = props.rows.filter((row) => row.progress.planned > 0);
  const sorted = listed.toSorted((left, right) =>
    compareTaskProgressPercent(
      { percent: left.progress.percent, title: left.title },
      { percent: right.progress.percent, title: right.title },
      direction,
    ),
  );
  const progress = sumTaskStepProgress(props.rows.map((row) => row.progress));

  return (
    <section
      aria-label="Step progress"
      className="flex min-w-0 flex-col gap-2 rounded-xl px-3 py-2.5 panel-well"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-sm font-medium text-foreground">Step progress</h2>
        <p className="text-xs text-muted-foreground tabular-nums">
          {listed.length} of {props.visibleThreads} threads
          {progress.percent === null ? "" : ` · ${progress.percent}% complete`}
        </p>
      </div>
      {progress.planned === 0 ? (
        <p className="text-xs text-muted-foreground">No todo lists in this view.</p>
      ) : (
        <>
          <TaskProgressMeter progress={progress} blockedReason={null} />
          <ul className="flex flex-wrap gap-x-3 gap-y-1 text-2xs text-muted-foreground">
            {SEGMENTS.map((segment) => (
              <li key={segment.key} className="flex items-center gap-1.5">
                <span aria-hidden className={cn("size-2 rounded-full", segment.className)} />
                {segment.label}
              </li>
            ))}
          </ul>
          <div className="max-h-44 overflow-auto">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-(--panel-well) text-muted-foreground">
                <tr>
                  <th className="py-1 pr-2 font-medium">Thread</th>
                  {props.showProject ? <th className="py-1 pr-2 font-medium">Project</th> : null}
                  <th
                    className="py-1 pr-2 text-right font-medium"
                    aria-sort={direction === "asc" ? "ascending" : "descending"}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setDirection((current) => (current === "desc" ? "asc" : "desc"))
                      }
                      className="cursor-pointer rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    >
                      % {direction === "desc" ? "↓" : "↑"}
                    </button>
                  </th>
                  <th className="py-1 pr-2 text-right font-medium">Done</th>
                  <th className="py-1 pr-2 text-right font-medium">Running</th>
                  <th className="py-1 pr-2 text-right font-medium">Pending</th>
                  <th className="py-1 text-right font-medium">Blocked</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((row) => (
                  <tr key={row.key} className="border-t border-(--panel-edge)">
                    <td className="max-w-48 py-1 pr-2">
                      <button
                        type="button"
                        onClick={() => props.onOpen(row.key)}
                        className="max-w-full cursor-pointer truncate text-left text-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      >
                        {row.title}
                      </button>
                    </td>
                    {props.showProject ? (
                      <td className="max-w-36 truncate py-1 pr-2 text-muted-foreground">
                        {row.project}
                      </td>
                    ) : null}
                    <td className="py-1 pr-2 text-right text-foreground tabular-nums">
                      {row.progress.percent}%
                    </td>
                    <td className="py-1 pr-2 text-right tabular-nums">{row.progress.completed}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{row.progress.running}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{row.progress.pending}</td>
                    <td className="py-1 text-right tabular-nums">
                      <BlockedCount count={row.progress.blocked} reason={row.blockedReason} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
