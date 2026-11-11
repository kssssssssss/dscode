import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";

import * as EnvironmentRegistry from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

export {
  choosePlannedTaskAttempt,
  describePlannedTaskFailure,
  planPlannedTaskRead,
} from "./plannedTaskSource.ts";
export type { PlannedTaskReadAttempt } from "./plannedTaskSource.ts";

const PLANNED_TASK_IDLE_TTL_MS = 60_000;

export function createPlannedTaskAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, E>,
) {
  return {
    subscribe: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:planned-tasks",
      tag: WS_METHODS.plannedTasksSubscribe,
      idleTtlMs: PLANNED_TASK_IDLE_TTL_MS,
    }),
    read: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:planned-tasks:read",
      tag: WS_METHODS.plannedTasksRead,
    }),
  };
}
