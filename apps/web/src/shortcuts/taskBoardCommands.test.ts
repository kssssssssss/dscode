import { describe, expect, it } from "vite-plus/test";

import { isOpenTasksShortcut } from "./taskBoardCommands";

const base = {
  key: "t",
  metaKey: false,
  ctrlKey: true,
  altKey: true,
  shiftKey: false,
  repeat: false,
  isComposing: false,
};

describe("isOpenTasksShortcut", () => {
  it("matches ctrl or meta with alt+t", () => {
    expect(isOpenTasksShortcut(base)).toBe(true);
    expect(isOpenTasksShortcut({ ...base, ctrlKey: false, metaKey: true, key: "T" })).toBe(true);
  });

  it("ignores the chord without alt, while typing, or when it repeats", () => {
    expect(isOpenTasksShortcut({ ...base, altKey: false })).toBe(false);
    expect(isOpenTasksShortcut({ ...base, shiftKey: true })).toBe(false);
    expect(isOpenTasksShortcut({ ...base, key: "y" })).toBe(false);
    expect(isOpenTasksShortcut({ ...base, repeat: true })).toBe(false);
    expect(isOpenTasksShortcut({ ...base, isComposing: true })).toBe(false);
  });
});
