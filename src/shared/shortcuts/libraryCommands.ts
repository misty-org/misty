import type { ShortcutCommandDefinition } from "./shortcutTypes";
import { command } from "./factory";

/** Commands scoped to a Space's Media page. */
export const libraryCommands: ShortcutCommandDefinition[] = [
  command("library.copy", "Copy Media selection", {
    description: "Copy the selected files in Media.",
    category: "Media",
    scope: "tool:library",
    mac: "Cmd+C",
    windows: "Ctrl+C",
  }),
];
