import type { AnyRouter } from "@tanstack/react-router";

import { isEditableFocused } from "../lib/editableFocus";
import { isTerminalFocused } from "../lib/terminalFocus";
import { registerCommands } from "./dispatcher";

export function isOpenTasksShortcut(
  event: Pick<
    KeyboardEvent,
    "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "repeat" | "isComposing"
  >,
): boolean {
  if (event.repeat || event.isComposing) return false;
  const mod = event.metaKey || event.ctrlKey;
  return mod && event.altKey && !event.shiftKey && event.key.toLowerCase() === "t";
}

/** Opens the task board. Kept off the keybinding config so older servers still load shortcuts. */
export function installTaskBoardShortcut(router: AnyRouter): () => void {
  return registerCommands(
    {},
    {
      when: (event) => !isTerminalFocused() && !isEditableFocused(event.target),
      onKeyDown: (event) => {
        if (!isOpenTasksShortcut(event)) return false;
        event.preventDefault();
        event.stopPropagation();
        void router.navigate({ to: "/tasks" });
      },
    },
  );
}
