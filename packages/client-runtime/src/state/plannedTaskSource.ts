import type { EnvironmentId, ExecutionEnvironmentDescriptor } from "@t3tools/contracts";
import { isLoopbackHost } from "@t3tools/shared/preview";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import * as Result from "effect/Result";

export interface PlannedTaskReaderCandidate {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  /** The connection URL; null for relay connections, `user@host` for SSH. */
  readonly displayUrl: string | null;
  readonly connection: { readonly phase: string };
  readonly primary: boolean;
  readonly serverConfig: {
    readonly environment: Pick<ExecutionEnvironmentDescriptor, "platform" | "capabilities">;
  } | null;
}

export interface PlannedTaskReadAttempt {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly note: string;
}

interface PlannedTaskReadPlan {
  readonly attempts: readonly PlannedTaskReadAttempt[];
  readonly waiting: boolean;
  readonly unavailableReason: string | null;
}

interface PlannedTaskAttemptResult {
  readonly _tag: "Success" | "Failure" | "Pending";
  readonly described?: { readonly unsupported: boolean; readonly detail: string };
}

const UNKNOWN_REQUEST = "Unknown request tag";

/** Ask the project server when it advertises planned tasks. Otherwise the primary
    server reads the checkout when both connections are loopback on the same OS. */
export function planPlannedTaskRead(input: {
  readonly projectName: string;
  readonly owner: EnvironmentId;
  readonly environments: readonly PlannedTaskReaderCandidate[];
}): PlannedTaskReadPlan {
  const owner = input.environments.find((environment) => environment.environmentId === input.owner);
  if (owner === undefined) {
    return {
      attempts: [],
      waiting: false,
      unavailableReason: `${input.projectName}: that project is not connected.`,
    };
  }
  if (configPending(owner)) {
    return { attempts: [], waiting: true, unavailableReason: null };
  }
  const ownerLabel = serverLabel(owner);
  if (supportsPlannedTasks(owner)) {
    if (owner.connection.phase === "connecting") {
      return { attempts: [], waiting: true, unavailableReason: null };
    }
    if (owner.connection.phase !== "connected") {
      return {
        attempts: [],
        waiting: false,
        unavailableReason: `${input.projectName}: ${ownerLabel} is not connected.`,
      };
    }
    const attempts = [attempt(owner, `${input.projectName}: Read by ${ownerLabel}.`)];
    const fallback = localFallback(input.projectName, owner, input.environments).attempts[0];
    if (fallback !== undefined && fallback.environmentId !== owner.environmentId) {
      attempts.push({
        ...fallback,
        note: `${input.projectName}: Read by ${fallback.label}. ${ownerLabel} rejected planned tasks.`,
      });
    }
    return { attempts, waiting: false, unavailableReason: null };
  }
  return localFallback(input.projectName, owner, input.environments);
}

export function choosePlannedTaskAttempt(
  results: readonly PlannedTaskAttemptResult[],
):
  | { readonly _tag: "pending" }
  | { readonly _tag: "success"; readonly index: number }
  | { readonly _tag: "failure"; readonly index: number; readonly detail: string } {
  for (let index = 0; index < results.length; index++) {
    const result = results[index];
    if (result === undefined || result._tag === "Pending") return { _tag: "pending" };
    if (result._tag === "Success") return { _tag: "success", index };
    if (result.described?.unsupported !== true) {
      return {
        _tag: "failure",
        index,
        detail: result.described?.detail ?? "Could not read planned tasks.",
      };
    }
  }
  const last = results.at(-1);
  if (last?._tag === "Failure") {
    return {
      _tag: "failure",
      index: results.length - 1,
      detail: last.described?.detail ?? "This server does not serve planned tasks.",
    };
  }
  return { _tag: "pending" };
}

export function describePlannedTaskFailure(cause: Cause.Cause<unknown>): {
  readonly unsupported: boolean;
  readonly detail: string;
} {
  const rendered = [Cause.pretty(cause)];
  const defect = Cause.findDefect(cause);
  if (Result.isSuccess(defect)) {
    const value = defect.success;
    if (value instanceof Error) rendered.push(value.message);
    else if (typeof value === "string") rendered.push(value);
  }
  const unsupported = rendered.some((text) => text.includes(UNKNOWN_REQUEST));
  const failed = Cause.findErrorOption(cause);
  if (Option.isSome(failed)) {
    const error = failed.value;
    if (
      typeof error === "object" &&
      error !== null &&
      "detail" in error &&
      typeof error.detail === "string" &&
      error.detail.length > 0
    ) {
      return { unsupported, detail: error.detail };
    }
    if (error instanceof Error && error.message.length > 0 && !unsupported) {
      return { unsupported, detail: error.message };
    }
  }
  if (unsupported) {
    return { unsupported: true, detail: "This server does not serve planned tasks." };
  }
  return { unsupported: false, detail: "Could not read planned tasks." };
}

function localFallback(
  projectName: string,
  owner: PlannedTaskReaderCandidate,
  environments: readonly PlannedTaskReaderCandidate[],
): PlannedTaskReadPlan {
  const ownerLabel = serverLabel(owner);
  const primary = environments.find(
    (environment) => environment.primary && environment.environmentId !== owner.environmentId,
  );
  if (primary === undefined) {
    return {
      attempts: [],
      waiting: false,
      unavailableReason: `${projectName}: ${ownerLabel} does not serve planned tasks.`,
    };
  }
  if (configPending(primary) || primary.connection.phase === "connecting") {
    return { attempts: [], waiting: true, unavailableReason: null };
  }
  const primaryLabel = serverLabel(primary);
  if (primary.connection.phase !== "connected") {
    return {
      attempts: [],
      waiting: false,
      unavailableReason: `${projectName}: ${ownerLabel} does not serve planned tasks, and ${primaryLabel} is not connected.`,
    };
  }
  if (!supportsPlannedTasks(primary)) {
    return {
      attempts: [],
      waiting: false,
      unavailableReason: `${projectName}: neither ${ownerLabel} nor ${primaryLabel} can read planned tasks.`,
    };
  }
  if (!sameMachine(owner, primary)) {
    const ownerHost = connectionHost(owner.displayUrl);
    const primaryHost = connectionHost(primary.displayUrl);
    const reason =
      ownerHost === "loopback" && primaryHost === "loopback"
        ? `${projectName}: ${ownerLabel} does not serve planned tasks, and ${primaryLabel} is a different system, so it cannot read these files.`
        : `${projectName}: ${ownerLabel} does not serve planned tasks, and ${primaryLabel} is not on the same machine, so it cannot read these files.`;
    return { attempts: [], waiting: false, unavailableReason: reason };
  }
  return {
    attempts: [
      attempt(
        primary,
        `${projectName}: Read by ${primaryLabel}. ${ownerLabel} does not serve planned tasks.`,
      ),
    ],
    waiting: false,
    unavailableReason: null,
  };
}

function attempt(environment: PlannedTaskReaderCandidate, note: string): PlannedTaskReadAttempt {
  return { environmentId: environment.environmentId, label: serverLabel(environment), note };
}

function supportsPlannedTasks(environment: PlannedTaskReaderCandidate): boolean {
  return environment.serverConfig?.environment.capabilities.plannedTasks === true;
}

function configPending(environment: PlannedTaskReaderCandidate): boolean {
  return (
    environment.serverConfig === null &&
    (environment.connection.phase === "connected" || environment.connection.phase === "connecting")
  );
}

function serverLabel(environment: PlannedTaskReaderCandidate): string {
  const host = endpoint(environment.displayUrl);
  return host === null ? environment.label : `${environment.label} (${host})`;
}

function endpoint(displayUrl: string | null): string | null {
  if (displayUrl === null) return null;
  try {
    const url = new URL(displayUrl);
    return url.port.length > 0 ? `${url.hostname}:${url.port}` : url.hostname;
  } catch {
    return null;
  }
}

function sameMachine(
  owner: PlannedTaskReaderCandidate,
  primary: PlannedTaskReaderCandidate,
): boolean {
  if (connectionHost(owner.displayUrl) !== "loopback") return false;
  if (connectionHost(primary.displayUrl) !== "loopback") return false;
  const ownerOs = owner.serverConfig?.environment.platform.os;
  const primaryOs = primary.serverConfig?.environment.platform.os;
  return ownerOs !== undefined && ownerOs === primaryOs;
}

function connectionHost(displayUrl: string | null): string | null {
  if (displayUrl === null) return null;
  let hostname: string;
  try {
    hostname = new URL(displayUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
  return isLoopbackHost(hostname) ? "loopback" : hostname;
}
