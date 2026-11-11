import * as Schema from "effect/Schema";

import { NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const PlannedTaskExecution = Schema.Literals([
  "open",
  "claimed",
  "resolved",
  "blocked",
  "unknown",
]);
export type PlannedTaskExecution = typeof PlannedTaskExecution.Type;

export const PlannedTask = Schema.Struct({
  topic: Schema.String,
  number: Schema.String,
  title: Schema.String,
  relativePath: Schema.String,
  status: Schema.NullOr(Schema.String),
  execution: PlannedTaskExecution,
  type: Schema.NullOr(Schema.String),
  blockedBy: Schema.Array(Schema.String),
  parent: Schema.Array(Schema.String),
  acceptanceChecked: NonNegativeInt,
  acceptanceTotal: NonNegativeInt,
  lastHistoryDate: Schema.NullOr(Schema.String),
  ready: Schema.Boolean,
});
export type PlannedTask = typeof PlannedTask.Type;

export const PlannedTaskSnapshot = Schema.Struct({
  issuesGlob: Schema.String,
  warning: Schema.NullOr(Schema.String),
  tasks: Schema.Array(PlannedTask),
});
export type PlannedTaskSnapshot = typeof PlannedTaskSnapshot.Type;

export const PlannedTaskSubscribeInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
});
export type PlannedTaskSubscribeInput = typeof PlannedTaskSubscribeInput.Type;

export const PlannedTaskReadInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString,
});
export type PlannedTaskReadInput = typeof PlannedTaskReadInput.Type;

export const PlannedTaskReadResult = Schema.Struct({
  relativePath: Schema.String,
  markdown: Schema.String,
});
export type PlannedTaskReadResult = typeof PlannedTaskReadResult.Type;

export class PlannedTaskReadError extends Schema.TaggedError<PlannedTaskReadError>()(
  "PlannedTaskReadError",
  {
    detail: Schema.String,
  },
) {
  override get message(): string {
    return this.detail;
  }
}
