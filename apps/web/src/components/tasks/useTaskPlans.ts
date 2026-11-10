import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";

import { environmentThreadDetails } from "../../state/threads";
import { selectTaskPlan, type TaskPlanSummary } from "./taskPlanSummary";

/**
 * Plans come from each thread's existing detail stream (the bounded snapshot plus
 * plan.updated). Quiet structure ignores streamed message text, so the board
 * does not rebuild on every token.
 */
export function useTaskPlans(
  threads: readonly { readonly environmentId: EnvironmentId; readonly threadId: ThreadId }[],
): ReadonlyMap<string, TaskPlanSummary | null> {
  const packed = threads
    .map((thread) => `${thread.environmentId}\u0000${thread.threadId}`)
    .join("\n");
  const atom = Atom.make((get) => {
    const next = new Map<string, TaskPlanSummary | null>();
    if (packed.length === 0) return next;
    for (const line of packed.split("\n")) {
      const separator = line.indexOf("\u0000");
      const ref = scopeThreadRef(
        line.slice(0, separator) as EnvironmentId,
        line.slice(separator + 1) as ThreadId,
      );
      const thread = get(environmentThreadDetails.quietThreadAtom(ref));
      if (thread === null) continue;
      next.set(
        `${ref.environmentId}:${ref.threadId}`,
        selectTaskPlan({
          plans: thread.projection.plans,
          runs: thread.projection.runs,
        }),
      );
    }
    return next;
  }).pipe(Atom.withLabel("task-board-plans"));
  return useAtomValue(atom);
}
