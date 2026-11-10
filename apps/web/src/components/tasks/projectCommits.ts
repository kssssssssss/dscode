import type { VcsProjectGraph } from "@t3tools/contracts";

export interface ProjectCommitRow {
  readonly id: string;
  readonly shortHash: string;
  readonly message: string;
  readonly author: string | null;
  readonly committedAtEpochSeconds: number | null;
  readonly branches: readonly string[];
}

/**
 * Recent commits from a project graph, newest first. A commit lists every local
 * branch whose first-parent history reaches it inside the graph window.
 */
export function recentProjectCommits(graph: VcsProjectGraph, limit: number): ProjectCommitRow[] {
  const byId = new Map(graph.commits.map((commit) => [commit.id, commit]));
  const branchesByCommit = new Map<string, string[]>();
  const branches = [...graph.branches].sort(
    (left, right) => Number(right.current) - Number(left.current),
  );
  for (const branch of branches) {
    const seen = new Set<string>();
    let current: string | undefined = branch.head;
    while (current !== undefined && !seen.has(current)) {
      const commit = byId.get(current);
      if (!commit) break;
      seen.add(current);
      const names = branchesByCommit.get(current);
      if (names) {
        if (!names.includes(branch.name)) names.push(branch.name);
      } else {
        branchesByCommit.set(current, [branch.name]);
      }
      current = commit.parents[0];
    }
  }
  return [...graph.commits]
    .sort((left, right) => {
      const leftTime = left.committedAtEpochSeconds ?? -1;
      const rightTime = right.committedAtEpochSeconds ?? -1;
      if (leftTime !== rightTime) return rightTime - leftTime;
      return right.id.localeCompare(left.id);
    })
    .slice(0, Math.max(0, limit))
    .map((commit) => ({
      id: commit.id,
      shortHash: commit.id.slice(0, 7),
      message: commit.subject,
      author: commit.author?.name.trim() || commit.author?.email.trim() || null,
      committedAtEpochSeconds: commit.committedAtEpochSeconds ?? null,
      branches: branchesByCommit.get(commit.id) ?? [],
    }));
}
