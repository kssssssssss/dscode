import { createPlannedTaskAtoms } from "@t3tools/client-runtime/state/plannedTasks";

import { connectionAtomRuntime } from "../connection/runtime";

export const plannedTasksEnvironment = createPlannedTaskAtoms(connectionAtomRuntime);
