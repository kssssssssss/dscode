import type { EnvironmentId } from "@t3tools/contracts";
import type { ReactNode } from "react";

import { useNowMinute } from "../../hooks/useNowMinute";
import { useEnvironmentQuery } from "../../state/query";
import { vcsEnvironment } from "../../state/vcs";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Button } from "../ui/button";
import { RefreshIcon } from "../ui/refresh-icon";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { recentProjectCommits } from "./projectCommits";

const COMMIT_LIMIT = 30;
const GRAPH_COMMIT_LIMIT = 200;

export function ProjectCommitList(props: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly controls?: ReactNode;
}) {
  const nowMinute = useNowMinute();
  const nowMs = Date.parse(`${nowMinute}:00.000Z`);
  const query = useEnvironmentQuery(
    vcsEnvironment.listRefs({
      environmentId: props.environmentId,
      input: {
        cwd: props.cwd,
        includeGraph: true,
        graphCommitLimit: GRAPH_COMMIT_LIMIT,
        refKind: "local",
        refresh: true,
      },
    }),
  );
  const graph = query.data?.graph;
  const commits = graph ? recentProjectCommits(graph, COMMIT_LIMIT) : [];

  return (
    <section aria-label="Recent commits" className="flex min-h-0 flex-col gap-2">
      <div className="flex items-center gap-2">
        <h2 className="text-xs font-medium text-muted-foreground">Recent commits</h2>
        {props.controls}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Refresh commits"
          disabled={query.isPending}
          onClick={() => query.refresh()}
        >
          <RefreshIcon refreshing={query.isPending} />
        </Button>
      </div>
      {query.isPending && commits.length === 0 ? (
        <p className="text-sm text-muted-foreground">Loading commits…</p>
      ) : null}
      {query.error ? <p className="text-sm text-destructive">{query.error}</p> : null}
      {query.data && !query.data.isRepo ? (
        <p className="text-sm text-muted-foreground">This checkout is not a Git repository.</p>
      ) : null}
      {query.data?.isRepo && !query.isPending && commits.length === 0 ? (
        <p className="text-sm text-muted-foreground">No commits yet.</p>
      ) : null}
      {commits.length > 0 ? (
        <ol className="flex flex-col gap-2">
          {commits.map((commit) => {
            const when =
              commit.committedAtEpochSeconds === null
                ? null
                : formatRelativeTimeLabel(
                    new Date(commit.committedAtEpochSeconds * 1000).toISOString(),
                    nowMs,
                  );
            return (
              <li key={commit.id} className="flex min-w-0 flex-col gap-0.5">
                <div className="flex min-w-0 items-baseline gap-2">
                  <Tooltip>
                    <TooltipTrigger
                      render={<span className="shrink-0 font-mono text-xs text-muted-foreground" />}
                    >
                      {commit.shortHash}
                    </TooltipTrigger>
                    <TooltipPopup>{commit.id}</TooltipPopup>
                  </Tooltip>
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                    {commit.message}
                  </span>
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  {commit.author ? <span className="truncate">{commit.author}</span> : null}
                  {when ? <span className="shrink-0 tabular-nums">{when}</span> : null}
                  {commit.branches.slice(0, 2).map((branch) => (
                    <span
                      key={branch}
                      className="max-w-40 truncate rounded-md bg-(--panel-surface) px-1.5 py-0.5 font-mono text-2xs"
                    >
                      {branch}
                    </span>
                  ))}
                  {commit.branches.length > 2 ? (
                    <span className="text-2xs">+{commit.branches.length - 2}</span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      ) : null}
      {graph?.truncated ? (
        <p className="text-xs text-muted-foreground">Older commits are omitted.</p>
      ) : null}
    </section>
  );
}
