import type { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type * as Option from "effect/Option";

import type { RemoteEnvironmentAuthorization } from "../authorization/service.ts";
import type { PreparedConnection } from "../connection/model.ts";
import type { ManagedRelayDpopSigner } from "../relay/managedRelay.ts";
import {
  executeAuthenticatedEnvironmentHttpRequest,
  withOrchestrationProtocolHeader,
} from "./environmentHttpAuth.ts";

/**
 * The bounded thread snapshot keeps the latest plan and drops older bodies. This reads the
 * full snapshot and keeps only the plans, so a board can show previous versions on demand.
 */
export const fetchEnvironmentThreadPlanSnapshot = Effect.fn(
  "clientRuntime.state.fetchEnvironmentThreadPlanSnapshot",
)(function* (input: {
  readonly prepared: PreparedConnection;
  readonly threadId: ThreadId;
  readonly signer: Option.Option<ManagedRelayDpopSigner["Service"]>;
  readonly remoteAuthorization?: Option.Option<RemoteEnvironmentAuthorization["Service"]>;
}) {
  const snapshot = yield* executeAuthenticatedEnvironmentHttpRequest({
    ...input,
    group: "orchestration",
    method: "GET",
    url: (urls) => urls.threadSnapshot({ params: { threadId: input.threadId } }),
    timeoutMs: 60_000,
    request: ({ client, headers }) =>
      client.threadSnapshot({
        params: { threadId: input.threadId },
        headers: withOrchestrationProtocolHeader(headers),
      }),
  });
  return {
    plans: snapshot.projection.plans,
    runs: snapshot.projection.runs.map((run) => ({ id: run.id, ordinal: run.ordinal })),
  };
});
