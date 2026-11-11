import {
  PlannedTaskReadError,
  type PlannedTaskReadResult,
  type PlannedTaskSnapshot,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import {
  annotatePlannedTasks,
  globSegments,
  parsePlannedTaskConfig,
  parsePlannedTaskMarkdown,
  PLANNED_TASK_CONFIG_PATH,
  segmentMatches,
  shouldSkipDirectory,
  type PlannedTaskSource,
} from "./plannedTaskMarkdown.ts";

const MARKDOWN_BYTE_LIMIT = 1_000_000;

export class PlannedTaskIndex extends Context.Service<
  PlannedTaskIndex,
  {
    readonly subscribe: (cwd: string) => Stream.Stream<PlannedTaskSnapshot, PlannedTaskReadError>;
    readonly read: (input: {
      readonly cwd: string;
      readonly relativePath: string;
    }) => Effect.Effect<PlannedTaskReadResult, PlannedTaskReadError>;
  }
>()("t3/plannedTasks/PlannedTaskIndex") {}

const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const workspacePaths = yield* WorkspacePaths.WorkspacePaths;
  const cache = yield* Ref.make(
    new Map<string, { readonly signature: string; readonly snapshot: PlannedTaskSnapshot }>(),
  );

  const fail = (detail: string) => new PlannedTaskReadError({ detail });

  const normalizeRoot = (cwd: string) =>
    workspacePaths
      .normalizeWorkspaceRoot(cwd)
      .pipe(
        Effect.mapError(
          () => new PlannedTaskReadError({ detail: `Could not read the project at ${cwd}.` }),
        ),
      );

  const staysInside = (root: string, target: string) => {
    const relative = path.relative(root, target);
    return (
      relative.length > 0 &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
    );
  };

  const readConfig = (root: string) =>
    fileSystem.readFileString(path.join(root, PLANNED_TASK_CONFIG_PATH)).pipe(
      Effect.map((text) => parsePlannedTaskConfig(text)),
      Effect.catch((error) =>
        error.reason._tag === "NotFound"
          ? Effect.succeed(parsePlannedTaskConfig(null))
          : Effect.fail(fail(`Could not read ${PLANNED_TASK_CONFIG_PATH}.`)),
      ),
    );

  const listMatching = (
    root: string,
    realRoot: string,
    segments: readonly string[],
  ): Effect.Effect<readonly string[], PlannedTaskReadError> => {
    // A span per directory would bury PlannedTaskIndex.load while the glob matches.
    // oxlint-disable-next-line t3code/prefer-effect-fn
    const visit = (
      directory: string,
      remaining: readonly string[],
    ): Effect.Effect<string[], PlannedTaskReadError> =>
      Effect.gen(function* () {
        if (remaining.length === 0) return [];
        const [head, ...rest] = remaining;
        if (head === undefined) return [];
        const entries = yield* fileSystem
          .readDirectory(directory)
          .pipe(
            Effect.catch((error) =>
              error.reason._tag === "NotFound"
                ? Effect.succeed<string[]>([])
                : Effect.fail(fail(`Could not list ${directory}.`)),
            ),
          );
        if (head === "**") {
          const here = yield* visit(directory, rest);
          const nested: string[] = [];
          for (const name of entries) {
            if (shouldSkipDirectory(name, head)) continue;
            const child = path.join(directory, name);
            const info = yield* fileSystem.stat(child).pipe(Effect.option);
            if (Option.isNone(info) || info.value.type !== "Directory") continue;
            nested.push(...(yield* visit(child, remaining)));
          }
          return [...here, ...nested];
        }
        const found: string[] = [];
        for (const name of entries) {
          if (!segmentMatches(head, name) || shouldSkipDirectory(name, head)) continue;
          const child = path.join(directory, name);
          const info = yield* fileSystem.stat(child).pipe(Effect.option);
          if (Option.isNone(info)) continue;
          if (rest.length === 0) {
            if (info.value.type !== "File") continue;
            const real = yield* fileSystem.realPath(child).pipe(Effect.option);
            if (Option.isNone(real) || !staysInside(realRoot, real.value)) continue;
            found.push(child);
            continue;
          }
          if (info.value.type === "Directory") found.push(...(yield* visit(child, rest)));
        }
        return found;
      });
    return visit(root, segments);
  };

  const load = Effect.fn("PlannedTaskIndex.load")(function* (cwd: string) {
    const root = yield* normalizeRoot(cwd);
    const realRoot = yield* fileSystem.realPath(root).pipe(Effect.orElseSucceed(() => root));
    const config = yield* readConfig(root);
    const files = yield* listMatching(root, realRoot, globSegments(config.issuesGlob));
    const listed: Array<{
      readonly filePath: string;
      readonly relativePath: string;
      readonly size: bigint;
    }> = [];
    const signatureParts = [`glob:${config.issuesGlob}`, `warning:${config.warning ?? ""}`];
    for (const filePath of files) {
      const relativePath = path.relative(root, filePath).replaceAll(path.sep, "/");
      const info = yield* fileSystem.stat(filePath).pipe(Effect.option);
      if (Option.isNone(info) || info.value.type !== "File") continue;
      const mtime = Option.match(info.value.mtime, {
        onNone: () => 0,
        onSome: (value) => value.getTime(),
      });
      signatureParts.push(`${relativePath}:${mtime}:${info.value.size}`);
      listed.push({ filePath, relativePath, size: info.value.size });
    }
    const signature = signatureParts.sort().join("\n");
    const cached = (yield* Ref.get(cache)).get(root);
    if (cached !== undefined && cached.signature === signature) return cached.snapshot;
    const parsed: PlannedTaskSource[] = [];
    for (const file of listed) {
      if (file.size > BigInt(MARKDOWN_BYTE_LIMIT)) continue;
      const markdown = yield* fileSystem
        .readFileString(file.filePath)
        .pipe(Effect.mapError(() => fail(`Could not read ${file.relativePath}.`)));
      const task = parsePlannedTaskMarkdown(file.relativePath, markdown);
      if (task !== null) parsed.push(task);
    }
    parsed.sort(
      (left, right) =>
        left.topic.localeCompare(right.topic) ||
        Number(left.number) - Number(right.number) ||
        left.relativePath.localeCompare(right.relativePath),
    );
    const snapshot: PlannedTaskSnapshot = {
      issuesGlob: config.issuesGlob,
      warning: config.warning,
      tasks: annotatePlannedTasks(parsed),
    };
    yield* Ref.update(cache, (current) => {
      const next = new Map(current);
      next.set(root, { signature, snapshot });
      return next;
    });
    return snapshot;
  });

  const watchDirs = Effect.fn("PlannedTaskIndex.watchDirs")(function* (root: string) {
    const candidates = [root, path.join(root, "tasks"), path.join(root, ".t3")];
    const existing: Array<{ readonly directory: string; readonly recursive: boolean }> = [];
    for (const directory of candidates) {
      const info = yield* fileSystem.stat(directory).pipe(Effect.option);
      if (Option.isNone(info) || info.value.type !== "Directory") continue;
      existing.push({
        directory,
        recursive: directory !== root && !directory.endsWith(`${path.sep}.t3`),
      });
    }
    return existing;
  });

  const subscribe: PlannedTaskIndex["Service"]["subscribe"] = (cwd) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const events = yield* Queue.unbounded<PlannedTaskSnapshot>();
        const publish = load(cwd).pipe(Effect.flatMap((snapshot) => Queue.offer(events, snapshot)));
        yield* publish;
        yield* Effect.forever(
          Effect.gen(function* () {
            const root = yield* normalizeRoot(cwd);
            const directories = yield* watchDirs(root);
            yield* Stream.mergeAll(
              directories.map((directory) =>
                fileSystem
                  .watch(directory.directory, { recursive: directory.recursive })
                  .pipe(Stream.catchCause(() => Stream.empty)),
              ),
              { concurrency: "unbounded" },
            ).pipe(Stream.take(1), Stream.runDrain);
            yield* Effect.sleep(Duration.millis(150));
            yield* publish;
          }).pipe(Effect.ignoreCause({ log: true })),
        ).pipe(Effect.forkScoped);
        yield* Effect.addFinalizer(() => Queue.shutdown(events));
        return Stream.fromQueue(events);
      }),
    );

  const read: PlannedTaskIndex["Service"]["read"] = Effect.fn("PlannedTaskIndex.read")(
    function* (input) {
      const snapshot = yield* load(input.cwd);
      const root = yield* normalizeRoot(input.cwd);
      const resolved = yield* workspacePaths
        .resolveRelativePathWithinRoot({
          workspaceRoot: root,
          relativePath: input.relativePath,
        })
        .pipe(Effect.mapError(() => fail("That file is outside the project.")));
      const allowed = snapshot.tasks.some((task) => task.relativePath === resolved.relativePath);
      if (!allowed) return yield* fail("That file is not a planned task in this project.");
      const realRoot = yield* fileSystem.realPath(root).pipe(Effect.orElseSucceed(() => root));
      const realFile = yield* fileSystem
        .realPath(resolved.absolutePath)
        .pipe(Effect.mapError(() => fail(`Could not read ${resolved.relativePath}.`)));
      if (!staysInside(realRoot, realFile)) {
        return yield* fail("That file is outside the project.");
      }
      const info = yield* fileSystem
        .stat(realFile)
        .pipe(Effect.mapError(() => fail(`Could not read ${resolved.relativePath}.`)));
      if (info.size > BigInt(MARKDOWN_BYTE_LIMIT)) {
        return yield* fail("That task file is too large to open here.");
      }
      const markdown = yield* fileSystem
        .readFileString(realFile)
        .pipe(Effect.mapError(() => fail(`Could not read ${resolved.relativePath}.`)));
      return { relativePath: resolved.relativePath, markdown };
    },
  );

  return PlannedTaskIndex.of({ subscribe, read });
});

export const layer = Layer.effect(PlannedTaskIndex, make);
