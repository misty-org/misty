import type { ShortcutCommandDefinition } from "./shortcutTypes";
import { command } from "./factory";

/** Commands scoped to the Library. */
export const libraryCommands: ShortcutCommandDefinition[] = [
  command("library.copy", "Copy Library selection", {
    description: "Copy the selected Library content.",
    category: "Library",
    scope: "tool:library",
    mac: "Cmd+C",
    windows: "Ctrl+C",
  }),
];
