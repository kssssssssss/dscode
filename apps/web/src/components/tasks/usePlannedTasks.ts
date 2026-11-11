import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  choosePlannedTaskAttempt,
  describePlannedTaskFailure,
  type PlannedTaskReadAttempt,
} from "@t3tools/client-runtime/state/plannedTasks";
import type { EnvironmentId, PlannedTaskSnapshot, ThreadId } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";

import { environmentThreadDetails } from "../../state/threads";
import { plannedTasksEnvironment } from "../../state/plannedTasks";

export interface PlannedTaskWorkspace {
  readonly projectKey: string;
  readonly projectName: string;
  readonly cwd: string;
  readonly attempts: readonly PlannedTaskReadAttempt[];
  readonly waiting: boolean;
  readonly unavailableReason: string | null;
}

export interface PlannedTaskLoaded {
  readonly projectKey: string;
  readonly projectName: string;
  /** The server that returned the files. Threads stay on the project server. */
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly snapshot: PlannedTaskSnapshot;
  readonly sourceNote: string;
}

export function usePlannedTaskSnapshots(workspaces: readonly PlannedTaskWorkspace[]): {
  readonly snapshots: readonly PlannedTaskLoaded[];
  readonly pending: boolean;
  readonly error: string | null;
} {
  const packed = JSON.stringify(workspaces);
  const atom = Atom.make((get) => {
    const snapshots: PlannedTaskLoaded[] = [];
    const errors: string[] = [];
    let pending = false;
    const requests = JSON.parse(packed) as readonly PlannedTaskWorkspace[];
    for (const workspace of requests) {
      if (workspace.waiting) {
        pending = true;
        continue;
      }
      if (workspace.attempts.length === 0) {
        if (workspace.unavailableReason !== null) errors.push(workspace.unavailableReason);
        continue;
      }
      const results = workspace.attempts.map((attempt) => {
        const result = get(
          plannedTasksEnvironment.subscribe({
            environmentId: attempt.environmentId,
            input: { cwd: workspace.cwd },
          }),
        );
        if (result._tag === "Success") {
          return { _tag: "Success" as const, snapshot: result.value, attempt };
        }
        if (result._tag === "Failure") {
          return {
            _tag: "Failure" as const,
            described: describePlannedTaskFailure(result.cause),
          };
        }
        return { _tag: "Pending" as const };
      });
      const choice = choosePlannedTaskAttempt(results);
      if (choice._tag === "pending") {
        pending = true;
        continue;
      }
      if (choice._tag === "failure") {
        const failed = results[choice.index];
        const attempt = workspace.attempts[choice.index];
        errors.push(
          failed?._tag === "Failure" && failed.described.unsupported && attempt !== undefined
            ? `${workspace.projectName}: ${attempt.label} does not serve planned tasks.`
            : `${workspace.projectName}: ${choice.detail}`,
        );
        continue;
      }
      const chosen = results[choice.index];
      if (chosen === undefined || chosen._tag !== "Success") continue;
      snapshots.push({
        projectKey: workspace.projectKey,
        projectName: workspace.projectName,
        environmentId: chosen.attempt.environmentId,
        cwd: workspace.cwd,
        snapshot: chosen.snapshot,
        sourceNote: chosen.attempt.note,
      });
    }
    return {
      snapshots,
      pending,
      error: errors.length > 0 ? errors.join(" ") : null,
    };
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
