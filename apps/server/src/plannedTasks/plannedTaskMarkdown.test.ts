// @effect-diagnostics nodeBuiltinImport:off - Fixtures are read once while the test file loads.
import * as NodeFS from "node:fs";
import { describe, expect, it } from "vite-plus/test";

import {
  annotatePlannedTasks,
  parsePlannedTaskConfig,
  parsePlannedTaskMarkdown,
  sameTaskNumber,
} from "./plannedTaskMarkdown.ts";

const fixture = (name: string) =>
  NodeFS.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

describe("parsePlannedTaskMarkdown", () => {
  it("reads a resolved task and does not treat triage status as progress", () => {
    const task = parsePlannedTaskMarkdown(
      "tasks/产品开发/issues/01-固化首条闭环契约与复用基线.md",
      fixture("01-固化首条闭环契约与复用基线.md"),
    );
    expect(task).toMatchObject({
      topic: "产品开发",
      number: "01",
      title: "固化首条闭环契约与复用基线",
      status: "ready-for-agent",
      execution: "resolved",
      type: "research",
      blockedBy: [],
      parent: [],
      acceptanceChecked: 5,
      acceptanceTotal: 5,
      lastHistoryDate: null,
    });
  });

  it("keeps a task with no Execution unknown, including its unchecked acceptance list", () => {
    const task = parsePlannedTaskMarkdown(
      "tasks/产品开发/issues/05-接入独立采集进程及可恢复交付.md",
      fixture("05-接入独立采集进程及可恢复交付.md"),
    );
    expect(task).toMatchObject({
      number: "05",
      execution: "unknown",
      status: "ready-for-agent",
      blockedBy: ["04"],
      acceptanceChecked: 0,
      acceptanceTotal: 5,
    });
  });

  it("reads parents, dependencies, and the latest history heading", () => {
    const task = parsePlannedTaskMarkdown(
      "tasks/产品开发/issues/49-提供病案整理人工分类与占用后端.md",
      fixture("49-提供病案整理人工分类与占用后端.md"),
    );
    expect(task).toMatchObject({
      number: "49",
      execution: "resolved",
      blockedBy: ["01", "30", "31", "36", "46"],
      parent: ["12", "15"],
      acceptanceChecked: 6,
      acceptanceTotal: 6,
      lastHistoryDate: "2026-11-11",
    });
  });

  it("ignores a topic index and still parses a numbered note outside issues", () => {
    expect(parsePlannedTaskMarkdown("tasks/产品开发/README.md", "# Index\n")).toBeNull();
    expect(parsePlannedTaskMarkdown("tasks/产品开发/34-实现记录.md", "# 34 notes\n")?.number).toBe(
      "34",
    );
  });
});

describe("annotatePlannedTasks", () => {
  const task = (
    number: string,
    execution: "open" | "claimed" | "resolved" | "blocked" | "unknown",
    blockedBy: string[] = [],
  ) => ({
    topic: "产品开发",
    number,
    title: number,
    relativePath: `tasks/产品开发/issues/${number}-t.md`,
    status: null,
    execution,
    type: "task",
    blockedBy,
    parent: [],
    acceptanceChecked: 0,
    acceptanceTotal: 0,
    lastHistoryDate: null,
  });

  it("marks an open task ready only when every blocker is resolved", () => {
    const [open, waiting, claimed] = annotatePlannedTasks([
      task("06", "open", ["05"]),
      task("07", "open", ["05", "08"]),
      task("09", "claimed", []),
      task("05", "resolved"),
      task("08", "unknown"),
    ]);
    expect(open?.ready).toBe(true);
    expect(waiting?.ready).toBe(false);
    expect(claimed?.ready).toBe(false);
    expect(sameTaskNumber("05", "5")).toBe(true);
  });

  it("treats a missing blocker as unmet and an empty list as ready", () => {
    const [missing, free] = annotatePlannedTasks([task("10", "open", ["99"]), task("11", "open")]);
    expect(missing?.ready).toBe(false);
    expect(free?.ready).toBe(true);
  });
});

describe("parsePlannedTaskConfig", () => {
  it("uses the default glob when the project has no config", () => {
    expect(parsePlannedTaskConfig(null)).toEqual({
      issuesGlob: "tasks/*/issues/*.md",
      warning: null,
    });
  });

  it("rejects a glob that leaves the project", () => {
    expect(parsePlannedTaskConfig('{"issuesGlob":"../tasks/*.md"}').issuesGlob).toBe(
      "tasks/*/issues/*.md",
    );
    expect(parsePlannedTaskConfig('{"issuesGlob":"notes/**/*.md"}').issuesGlob).toBe(
      "notes/**/*.md",
    );
  });
});
