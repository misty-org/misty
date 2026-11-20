import type { ShortcutCommandDefinition } from "./shortcutTypes";
import { command } from "./factory";

/** Commands scoped to a Space's Media page. */
export const libraryCommands: ShortcutCommandDefinition[] = [
  command("library.copy", "Copy Files selection", {
    description: "Copy the selected files.",
    category: "Files",
    scope: "tool:library",
    mac: "Cmd+C",
    windows: "Ctrl+C",
  }),
];
