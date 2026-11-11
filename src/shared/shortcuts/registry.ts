import type {
  ShortcutBindingPair,
  ShortcutCommandDefinition,
  ShortcutPlatform,
} from "./shortcutTypes";
import { command } from "./factory";
import { focusModeCommands } from "./viewAndTabCommands";
import { libraryCommands } from "./libraryCommands";
import { workspaceCommands } from "./workspaceCommands";
export type * from "./shortcutTypes";
const shellCommands: ShortcutCommandDefinition[] = [
  command("misty.contextual_companion", "Toggle chat panel", {
    description: "Open or close the chat panel beside the page.",
    category: "Misty",
    aliases: ["assistant", "ask misty"],
    mac: "Cmd+Shift+K",
    windows: "Ctrl+Shift+K",
    allowInEditable: true,
    nativeMenu: false,
    allowShadowing: true,
  }),
  command("app.open_settings", "Open settings", {
    description: "Open Misty settings.",
    category: "Misty",
    aliases: ["preferences", "configuration"],
    mac: "Cmd+Comma",
    windows: "Ctrl+Comma",
    allowInEditable: true,
    nativeMenu: true,
  }),
  command("account.sign_in", "Sign in", {
    description: "Sign in to sync, share Spaces and use agents.",
    category: "Misty",
    aliases: ["log in", "account", "create account"],
    allowInEditable: true,
    nativeMenu: true,
  }),
  command("account.sign_out", "Sign out", {
    description: "Sign out of Misty on this computer.",
    category: "Misty",
    aliases: ["log out", "account"],
    allowInEditable: true,
    nativeMenu: true,
  }),
  ...focusModeCommands,
  command("app.zoom_in", "Scale app up", {
    description: "Make Misty's own interface larger.",
    category: "View",
    mac: "Cmd+Shift+Plus",
    macAlternate: "Ctrl+Shift+Plus",
    windows: "Ctrl+Shift+Plus",
    allowInEditable: true,
    repeatable: true,
    nativeMenu: true,
  }),
  command("app.zoom_out", "Scale app down", {
    description: "Make Misty's own interface smaller.",
    category: "View",
    mac: "Cmd+Shift+Minus",
    macAlternate: "Ctrl+Shift+Minus",
    windows: "Ctrl+Shift+Minus",
    allowInEditable: true,
    repeatable: true,
    nativeMenu: true,
  }),
  command("app.zoom_reset", "Reset app scale", {
    description: "Return Misty's own interface to its default scale.",
    category: "View",
    mac: "Cmd+Shift+0",
    macAlternate: "Ctrl+Shift+0",
    windows: "Ctrl+Shift+0",
    allowInEditable: true,
    nativeMenu: true,
  }),
];

/** The Space home's tabs, on ⌘1 to ⌘4 while a Space is focused (window tabs elsewhere). */
const spaceSections = ["Home", "Notes", "Drawings", "Files"] as const;

const tabAndToolCommands = [
  ...spaceSections.map((label, index) =>
    command(`space.section_${index + 1}`, `Open ${label}`, {
      description: `Open this Space's ${label}.`,
      category: "Spaces",
      scope: "tool:space",
      aliases: ["space", "section", label.toLowerCase()],
      mac: `Cmd+${index + 1}`,
      windows: `Ctrl+${index + 1}`,
      allowInEditable: true,
      allowShadowing: true,
    }),
  ),
  ...Array.from({ length: 9 }, (_, index) =>
    command(
      `workspace.tab_${index + 1}`,
      index === 8 ? "Select last tab" : `Select tab ${index + 1}`,
      {
        description:
          index === 8
            ? "Select the last tab in the focused pane."
            : `Select tab ${index + 1} in the focused pane.`,
        category: "Tabs",
        scope: "workspace",
        mac: `Cmd+${index + 1}`,
        windows: `Ctrl+${index + 1}`,
        allowInEditable: true,
      },
    ),
  ),
];

export const shortcutCommandRegistry: ShortcutCommandDefinition[] = [
  ...shellCommands,
  ...workspaceCommands,
  ...tabAndToolCommands,
  ...libraryCommands,
];

export const shortcutCommandsById = new Map(
  shortcutCommandRegistry.map((definition) => [definition.id, definition]),
);

export function defaultBindingsFor(
  definition: ShortcutCommandDefinition,
  platform: ShortcutPlatform,
): ShortcutBindingPair {
  return definition.defaults[platform];
}
