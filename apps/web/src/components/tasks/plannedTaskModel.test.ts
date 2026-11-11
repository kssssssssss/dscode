import { describe, expect, it } from "vite-plus/test";

import {
  linkThreadsToPlannedTasks,
  plannedTaskForest,
  plannedTaskKey,
  summarizePlannedTasks,
  type PlannedLinkThread,
} from "./plannedTaskModel";

const task = (
  number: string,
  topic = "产品开发",
  extra: {
    parent?: string[];
    execution?: "open" | "resolved";
    checked?: number;
    total?: number;
  } = {},
) => ({
  projectKey: "alpha",
  topic,
  number,
  title: `任务 ${number}`,
  relativePath: `tasks/${topic}/issues/${number}-t.md`,
  status: "ready-for-agent",
  execution: extra.execution ?? "open",
  type: "task",
  blockedBy: [],
  parent: extra.parent ?? [],
  acceptanceChecked: extra.checked ?? 0,
  acceptanceTotal: extra.total ?? 2,
  lastHistoryDate: null,
  ready: false,
});

const thread = (
  key: string,
  title: string,
  extra: Partial<PlannedLinkThread> = {},
): PlannedLinkThread => ({
  key,
  projectKey: "alpha",
  title,
  branch: null,
  worktreePath: null,
  openingText: null,
  ...extra,
});

describe("linkThreadsToPlannedTasks", () => {
  const tasks = [task("49"), task("12"), task("01", "采集接入")];

  it("links a number in the title, a task word, a hash, or a filename", () => {
    const linked = linkThreadsToPlannedTasks({
      tasks,
      threads: [
        thread("a", "49"),
        thread("b", "任务49"),
        thread("c", "fix #12"),
        thread("d", "notes", { branch: "49-整理" }),
        thread("e", "look", { openingText: "请看 tasks/产品开发/issues/49-整理.md" }),
      ],
      manual: {},
    });
    expect(linked.get(plannedTaskKey("alpha", "产品开发", "49"))).toEqual(["a", "b", "d", "e"]);
    expect(linked.get(plannedTaskKey("alpha", "产品开发", "12"))).toEqual(["c"]);
  });

  it("does not guess when the same number exists in two topics", () => {
    const linked = linkThreadsToPlannedTasks({
      tasks: [task("01"), task("01", "采集接入")],
      threads: [thread("a", "#01"), thread("b", "采集接入 #01")],
      manual: {},
    });
    expect(linked.get(plannedTaskKey("alpha", "产品开发", "01"))).toBeUndefined();
    expect(linked.get(plannedTaskKey("alpha", "采集接入", "01"))).toEqual(["b"]);
  });

  it("lets a manual link or unlink replace the guess", () => {
    const linked = linkThreadsToPlannedTasks({
      tasks,
      threads: [thread("a", "49-实现"), thread("b", "49-验收")],
      manual: {
        a: { topic: "产品开发", number: "12" },
        b: null,
      },
    });
    expect(linked.get(plannedTaskKey("alpha", "产品开发", "12"))).toEqual(["a"]);
    expect(linked.get(plannedTaskKey("alpha", "产品开发", "49"))).toBeUndefined();
  });
});

describe("summarizePlannedTasks", () => {
  it("counts each task once and ignores a finished thread", () => {
    const tasks = [
      task("12", "产品开发", { execution: "open", checked: 1, total: 2 }),
      task("15", "产品开发", { execution: "open", checked: 0, total: 0 }),
      task("49", "产品开发", { execution: "resolved", parent: ["12", "15"], checked: 2, total: 2 }),
    ];
    const linked = linkThreadsToPlannedTasks({
      tasks,
      threads: [thread("done", "49-done")],
      manual: {},
    });
    expect(linked.get(plannedTaskKey("alpha", "产品开发", "49"))).toEqual(["done"]);
    expect(summarizePlannedTasks(tasks)).toMatchObject({
      taskCount: 3,
      byExecution: { open: 2, resolved: 1, unknown: 0 },
      acceptanceChecked: 3,
      acceptanceTotal: 4,
    });
    const forest = plannedTaskForest(tasks);
    const parent12 = forest.find((node) => node.task.number === "12");
    const parent15 = forest.find((node) => node.task.number === "15");
    expect(parent12?.children.map((child) => child.task.number)).toEqual(["49"]);
    expect(parent12?.rollupChecked).toBe(3);
    expect(parent15?.rollupChecked).toBe(2);
    expect(forest.some((node) => node.task.number === "49")).toBe(false);
  });
});
