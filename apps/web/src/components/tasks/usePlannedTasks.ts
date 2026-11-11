import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, PlannedTaskSnapshot, ThreadId } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";

import { environmentThreadDetails } from "../../state/threads";
import { plannedTasksEnvironment } from "../../state/plannedTasks";

export interface PlannedTaskWorkspace {
  readonly projectKey: string;
  readonly projectName: string;
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
}

export function usePlannedTaskSnapshots(workspaces: readonly PlannedTaskWorkspace[]): {
  readonly snapshots: readonly (PlannedTaskWorkspace & {
    readonly snapshot: PlannedTaskSnapshot;
  })[];
  readonly pending: boolean;
  readonly error: string | null;
} {
  const packed = workspaces
    .map(
      (workspace) =>
        `${workspace.environmentId}\u0000${workspace.cwd}\u0000${workspace.projectKey}\u0000${workspace.projectName}`,
    )
    .join("\n");
  const atom = Atom.make((get) => {
    const snapshots: Array<PlannedTaskWorkspace & { readonly snapshot: PlannedTaskSnapshot }> = [];
    let pending = false;
    let error: string | null = null;
    if (packed.length === 0) return { snapshots, pending, error };
    for (const line of packed.split("\n")) {
      const [environmentId, cwd, projectKey, projectName] = line.split("\u0000");
      if (environmentId === undefined || cwd === undefined || projectKey === undefined) continue;
      const result = get(
        plannedTasksEnvironment.subscribe({
          environmentId: environmentId as EnvironmentId,
          input: { cwd },
        }),
      );
      if (result._tag === "Success") {
        snapshots.push({
          projectKey,
          projectName: projectName ?? projectKey,
          environmentId: environmentId as EnvironmentId,
          cwd,
          snapshot: result.value,
        });
      } else if (result._tag === "Failure") {
        error = "Could not read planned tasks.";
      } else {
        pending = true;
      }
    }
    return { snapshots, pending, error };
  }).pipe(Atom.withLabel("planned-task-snapshots"));
  return useAtomValue(atom);
}

export function useThreadOpeningTexts(
  threads: readonly { readonly environmentId: EnvironmentId; readonly threadId: ThreadId }[],
): ReadonlyMap<string, string> {
  const packed = threads
    .map((thread) => `${thread.environmentId}\u0000${thread.threadId}`)
    .join("\n");
  const atom = Atom.make((get) => {
    const next = new Map<string, string>();
    if (packed.length === 0) return next;
    for (const line of packed.split("\n")) {
      const separator = line.indexOf("\u0000");
      const ref = scopeThreadRef(
        line.slice(0, separator) as EnvironmentId,
        line.slice(separator + 1) as ThreadId,
      );
      const thread = get(environmentThreadDetails.quietThreadAtom(ref));
      if (thread === null) continue;
      const text = openingText(thread.projection.turnItems, thread.projection.visibleTurnItems);
      if (text !== null) next.set(`${ref.environmentId}:${ref.threadId}`, text);
    }
    return next;
  }).pipe(Atom.withLabel("planned-task-opening-text"));
  return useAtomValue(atom);
}

function openingText(
  turnItems: readonly { readonly type: string; readonly ordinal: number }[],
  visibleTurnItems: readonly {
    readonly item: { readonly type: string; readonly ordinal: number };
  }[],
): string | null {
  let bestOrdinal = Number.POSITIVE_INFINITY;
  let bestText: string | null = null;
  const consider = (item: { readonly type: string; readonly ordinal: number }) => {
    if (item.type !== "user_message") return;
    if (!("text" in item) || typeof item.text !== "string" || item.text.length === 0) return;
    if ("createdBy" in item && item.createdBy !== "user") return;
    if (item.ordinal < bestOrdinal) {
      bestOrdinal = item.ordinal;
      bestText = item.text;
    }
  };
  for (const item of turnItems) consider(item);
  for (const row of visibleTurnItems) consider(row.item);
  return bestText;
}
