import { describe, expect, it } from "vite-plus/test";
import type { VcsProjectGraph } from "@t3tools/contracts";

import { recentProjectCommits } from "./projectCommits";

function graph(overrides: Partial<VcsProjectGraph> = {}): VcsProjectGraph {
  return {
    defaultBranch: "main",
    branches: [
      { name: "main", head: "ccc3333", current: true, merged: false },
      { name: "feature", head: "bbb2222", current: false, merged: false },
    ],
    commits: [
      {
        id: "aaa1111",
        parents: [],
        subject: "init",
        committedAtEpochSeconds: 10,
        author: { name: "Ada", email: "ada@example.com" },
      },
      {
        id: "bbb2222",
        parents: ["aaa1111"],
        subject: "feature work",
        committedAtEpochSeconds: 20,
        author: { name: " ", email: "grace@example.com" },
      },
      {
        id: "ccc3333",
        parents: ["aaa1111"],
        subject: "main tip",
        committedAtEpochSeconds: 30,
        author: { name: "Ada", email: "ada@example.com" },
      },
    ],
    worktrees: [],
    truncated: false,
    ...overrides,
  };
}

describe("recentProjectCommits", () => {
  it("lists newest commits with the branches that contain them", () => {
    expect(recentProjectCommits(graph(), 10)).toEqual([
      {
        id: "ccc3333",
        shortHash: "ccc3333",
        message: "main tip",
        author: "Ada",
        committedAtEpochSeconds: 30,
        branches: ["main"],
      },
      {
        id: "bbb2222",
        shortHash: "bbb2222",
        message: "feature work",
        author: "grace@example.com",
        committedAtEpochSeconds: 20,
        branches: ["feature"],
      },
      {
        id: "aaa1111",
        shortHash: "aaa1111",
        message: "init",
        author: "Ada",
        committedAtEpochSeconds: 10,
        branches: ["main", "feature"],
      },
    ]);
  });

  it("keeps the requested limit and drops commits the graph did not time", () => {
    const history = graph({
      commits: [{ id: "undated", parents: [], subject: "no time" }, ...graph().commits],
    });
    const rows = recentProjectCommits(history, 2);
    expect(rows.map((row) => row.id)).toEqual(["ccc3333", "bbb2222"]);
  });
});
