import * as NodeServices from "@effect/platform-node/NodeServices";
import { makeMethods } from "@effect/vitest";
import { describe, expect, it as baseIt } from "vite-plus/test";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";

const it = makeMethods(baseIt);

import * as PlannedTaskIndex from "./PlannedTaskIndex.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";

const layerTest = Layer.empty.pipe(
  Layer.provideMerge(PlannedTaskIndex.layer),
  Layer.provideMerge(WorkspacePaths.layer),
  Layer.provideMerge(NodeServices.layer),
);

const makeTempDir = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-planned-tasks-" });
});

describe("PlannedTaskIndex", () => {
  it.effect("reads numbered issues, including a Chinese topic directory", () =>
    Effect.gen(function* () {
      const index = yield* PlannedTaskIndex.PlannedTaskIndex;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const cwd = yield* makeTempDir;
      const issue = path.join(cwd, "tasks", "产品开发", "issues", "05-接入.md");
      yield* fileSystem.makeDirectory(path.dirname(issue), { recursive: true });
      yield* fileSystem.writeFileString(
        issue,
        [
          "# 05 接入独立进程",
          "",
          "Status: ready-for-agent",
          "Blocked by: 04",
          "",
          "## 验收条件",
          "",
          "- [ ] 一条",
        ].join("\n"),
      );
      yield* fileSystem.writeFileString(
        path.join(cwd, "tasks", "产品开发", "34-实现记录.md"),
        "# 34 notes\n",
      );
      const first = yield* Stream.runHead(index.subscribe(cwd));
      expect(first._tag).toBe("Some");
      if (first._tag !== "Some") return;
      expect(first.value.issuesGlob).toBe("tasks/*/issues/*.md");
      expect(first.value.tasks).toMatchObject([
        {
          topic: "产品开发",
          number: "05",
          title: "接入独立进程",
          execution: "unknown",
          blockedBy: ["04"],
          acceptanceChecked: 0,
          acceptanceTotal: 1,
          ready: false,
        },
      ]);

      yield* fileSystem.writeFileString(
        path.join(path.dirname(issue), "04-前置.md"),
        ["# 04 前置", "", "Execution: resolved", "", "## 交付与验收", "", "- [x] 完成"].join("\n"),
      );
      const second = yield* Stream.runHead(index.subscribe(cwd));
      if (second._tag !== "Some") return;
      expect(second.value.tasks.find((task) => task.number === "05")?.ready).toBe(false);
      expect(second.value.tasks.find((task) => task.number === "04")?.execution).toBe("resolved");
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("honors .t3/task-board.json and refuses a file outside the glob", () =>
    Effect.gen(function* () {
      const index = yield* PlannedTaskIndex.PlannedTaskIndex;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const cwd = yield* makeTempDir;
      yield* fileSystem.makeDirectory(path.join(cwd, ".t3"), { recursive: true });
      yield* fileSystem.writeFileString(
        path.join(cwd, ".t3", "task-board.json"),
        '{"issuesGlob":"notes/*.md"}',
      );
      const issue = path.join(cwd, "notes", "12-父任务.md");
      yield* fileSystem.makeDirectory(path.dirname(issue), { recursive: true });
      yield* fileSystem.writeFileString(issue, "# 12 父任务\n\nExecution: open\n");
      const snapshot = yield* Stream.runHead(index.subscribe(cwd));
      if (snapshot._tag !== "Some") return;
      expect(snapshot.value.issuesGlob).toBe("notes/*.md");
      expect(snapshot.value.tasks.map((task) => task.number)).toEqual(["12"]);
      const read = yield* index.read({ cwd, relativePath: "notes/12-父任务.md" });
      expect(read.markdown.startsWith("# 12")).toBe(true);
      const outside = yield* Effect.exit(index.read({ cwd, relativePath: "../secret.md" }));
      expect(outside._tag).toBe("Failure");
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("refuses a root that is not an absolute directory on this machine", () =>
    Effect.gen(function* () {
      const index = yield* PlannedTaskIndex.PlannedTaskIndex;
      const relative = yield* Effect.exit(Stream.runHead(index.subscribe("tasks")));
      expect(failureDetail(relative)).toContain("absolute path");
      const parent = yield* Effect.exit(
        Stream.runHead(index.subscribe("/tmp/t3-planned-tasks/../etc")),
      );
      expect(failureDetail(parent)).toContain("absolute path");
      const missing = yield* Effect.exit(
        Stream.runHead(index.subscribe("/tmp/t3-planned-tasks-missing-root")),
      );
      expect(failureDetail(missing)).toContain("not on this machine");
      const escaped = yield* Effect.exit(index.read({ cwd: "tasks", relativePath: "01.md" }));
      expect(failureDetail(escaped)).toContain("absolute path");
    }).pipe(Effect.provide(layerTest)),
  );
});

function failureDetail(exit: {
  readonly _tag: string;
  readonly cause?: Cause.Cause<unknown>;
}): string {
  if (exit._tag !== "Failure" || exit.cause === undefined) return "";
  const error = Cause.findErrorOption(exit.cause);
  if (Option.isSome(error)) {
    const value = error.value;
    if (
      typeof value === "object" &&
      value !== null &&
      "detail" in value &&
      typeof value.detail === "string"
    ) {
      return value.detail;
    }
  }
  return Cause.pretty(exit.cause);
}
