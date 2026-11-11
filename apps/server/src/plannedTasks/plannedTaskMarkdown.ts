import type { PlannedTask, PlannedTaskExecution } from "@t3tools/contracts";

const DEFAULT_PLANNED_TASK_GLOB = "tasks/*/issues/*.md";
export const PLANNED_TASK_CONFIG_PATH = ".t3/task-board.json";

const ACCEPTANCE_HEADINGS = new Set(["交付与验收", "验收条件", "范围与验收"]);
const EXECUTIONS = new Set<PlannedTaskExecution>(["open", "claimed", "resolved", "blocked"]);
const SKIP_DIRECTORIES = new Set([".git", "node_modules", "dist"]);

export type PlannedTaskSource = Omit<PlannedTask, "ready">;

// Status is triage only. Execution is the lifecycle, and a missing Execution is
// unknown rather than done. Acceptance boxes live under 交付与验收, or the older
// 验收条件 / 范围与验收 heading. A dated ## heading is history, not a new state.
export function parsePlannedTaskMarkdown(
  relativePath: string,
  markdown: string,
): PlannedTaskSource | null {
  const normalized = relativePath.replaceAll("\\", "/").replace(/^\uFEFF/, "");
  const filename = normalized.slice(normalized.lastIndexOf("/") + 1);
  const numberMatch = /^(\d+)-.+\.md$/iu.exec(filename);
  if (numberMatch === null) return null;
  const text = markdown.replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/);
  const title = taskTitle(lines[0] ?? "", filename, numberMatch[1] ?? "");
  const fields = headerFields(lines);
  const execution = executionOf(fields.execution);
  const acceptance = acceptanceCounts(lines);
  return {
    topic: topicOf(normalized),
    number: numberMatch[1] ?? "",
    title,
    relativePath: normalized,
    status: fields.status ?? null,
    execution,
    type: fields.type ?? null,
    blockedBy: numberList(fields["blocked by"]),
    parent: numberList(fields["parent task"]),
    acceptanceChecked: acceptance.checked,
    acceptanceTotal: acceptance.total,
    lastHistoryDate: lastHistoryDate(lines),
  };
}

export function annotatePlannedTasks(tasks: readonly PlannedTaskSource[]): PlannedTask[] {
  const byTopic = new Map<string, PlannedTaskSource[]>();
  for (const task of tasks) {
    const list = byTopic.get(task.topic);
    if (list === undefined) byTopic.set(task.topic, [task]);
    else list.push(task);
  }
  return tasks.map((task) => ({
    ...task,
    ready: isReady(task, byTopic.get(task.topic) ?? []),
  }));
}

export function parsePlannedTaskConfig(text: string | null): {
  readonly issuesGlob: string;
  readonly warning: string | null;
} {
  if (text === null) return { issuesGlob: DEFAULT_PLANNED_TASK_GLOB, warning: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    return {
      issuesGlob: DEFAULT_PLANNED_TASK_GLOB,
      warning: `${PLANNED_TASK_CONFIG_PATH} is not valid JSON. Using ${DEFAULT_PLANNED_TASK_GLOB}.`,
    };
  }
  if (parsed === null || typeof parsed !== "object" || !("issuesGlob" in parsed)) {
    return { issuesGlob: DEFAULT_PLANNED_TASK_GLOB, warning: null };
  }
  const glob = parsed.issuesGlob;
  if (typeof glob !== "string" || !isSafeIssuesGlob(glob)) {
    return {
      issuesGlob: DEFAULT_PLANNED_TASK_GLOB,
      warning: `issuesGlob in ${PLANNED_TASK_CONFIG_PATH} must be a relative glob. Using ${DEFAULT_PLANNED_TASK_GLOB}.`,
    };
  }
  return { issuesGlob: glob, warning: null };
}

function isSafeIssuesGlob(glob: string): boolean {
  if (glob.length === 0 || glob.length > 240) return false;
  if (glob.startsWith("/") || glob.includes("\\") || glob.includes("\0")) return false;
  return glob
    .split("/")
    .every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

export function globSegments(glob: string): readonly string[] {
  return glob.split("/").filter((segment) => segment.length > 0);
}

export function segmentMatches(pattern: string, name: string): boolean {
  if (pattern === "**") return true;
  const expression = pattern
    .split("*")
    .map((part) => part.replace(/[|\\{}()[\]^$+?.]/gu, "\\$&"))
    .join("[^/]*");
  return new RegExp(`^${expression}$`, "iu").test(name);
}

export function shouldSkipDirectory(name: string, pattern: string | undefined): boolean {
  return SKIP_DIRECTORIES.has(name) && pattern !== name;
}

function isReady(task: PlannedTaskSource, topicTasks: readonly PlannedTaskSource[]): boolean {
  if (task.execution !== "open") return false;
  return task.blockedBy.every((dependency) =>
    topicTasks.some(
      (other) => sameTaskNumber(other.number, dependency) && other.execution === "resolved",
    ),
  );
}

export function sameTaskNumber(left: string, right: string): boolean {
  return /^\d+$/u.test(left) && /^\d+$/u.test(right) && Number(left) === Number(right);
}

function topicOf(relativePath: string): string {
  const parts = relativePath.split("/");
  const issues = parts.lastIndexOf("issues");
  if (issues > 0) return parts[issues - 1] ?? "";
  return parts.length >= 2 ? (parts[parts.length - 2] ?? "") : "";
}

function taskTitle(firstLine: string, filename: string, number: string): string {
  const heading = /^#\s+(.+)$/u.exec(firstLine.trim());
  const raw = heading?.[1] ?? filename.replace(/\.md$/iu, "");
  const stripped = raw.replace(new RegExp(`^${number}\\s+`, "u"), "").trim();
  return stripped.length > 0 ? stripped : raw.trim();
}

function headerFields(lines: readonly string[]): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of lines.slice(1)) {
    if (line.trim().length === 0) {
      if (Object.keys(fields).length > 0) break;
      continue;
    }
    if (line.startsWith("#")) break;
    const match = /^([A-Za-z][A-Za-z ]{0,40}):\s*(.*)$/u.exec(line);
    if (match === null) break;
    const key = (match[1] ?? "").trim().toLowerCase().replace(/\s+/gu, " ");
    fields[key] = (match[2] ?? "").trim();
  }
  return fields;
}

function executionOf(value: string | undefined): PlannedTaskExecution {
  const normalized = value?.trim().toLowerCase();
  if (normalized !== undefined && EXECUTIONS.has(normalized as PlannedTaskExecution)) {
    return normalized as PlannedTaskExecution;
  }
  return "unknown";
}

function numberList(value: string | undefined): string[] {
  if (value === undefined || value.length === 0) return [];
  const numbers: string[] = [];
  for (const token of value.split(/[,，、]/u)) {
    const match = /(\d+)/u.exec(token);
    if (match?.[1] !== undefined) numbers.push(match[1]);
  }
  return numbers;
}

function acceptanceCounts(lines: readonly string[]): { checked: number; total: number } {
  let inSection = false;
  let checked = 0;
  let total = 0;
  for (const line of lines) {
    const heading = /^##\s+(.+?)\s*$/u.exec(line);
    if (heading !== null) {
      if (inSection) break;
      const name = (heading[1] ?? "").split(/[（(]/u)[0]?.trim() ?? "";
      inSection = ACCEPTANCE_HEADINGS.has(name);
      continue;
    }
    if (!inSection) continue;
    const box = /^\s*[-*]\s+\[([ xX])\]/u.exec(line);
    if (box === null) continue;
    total += 1;
    if ((box[1] ?? "").toLowerCase() === "x") checked += 1;
  }
  return { checked, total };
}

function lastHistoryDate(lines: readonly string[]): string | null {
  let latest: string | null = null;
  for (const line of lines) {
    const match = /^##\s+.+[（(]\s*(\d{4}-\d{2}-\d{2})\s*[）)]/u.exec(line);
    const date = match?.[1];
    if (date !== undefined && (latest === null || date > latest)) latest = date;
  }
  return latest;
}
