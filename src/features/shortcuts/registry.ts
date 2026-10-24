import type { ShortcutBindingPair, ShortcutCommandDefinition, ShortcutPlatform } from "./types";
import { command } from "./factory";
import { focusModeCommands } from "./browserFeatureCommands";
import { browserCommands } from "./browserCommands";
import { workspaceCommands } from "./workspaceCommands";
export type * from "./types";
const shellCommands: ShortcutCommandDefinition[] = [
  command("search.toggle", "New tab", {
    description:
      "Open a new tab: open an address, search the web, ask an agent or jump to any page. Type @ to pick an agent.",
    category: "Navigation",
    aliases: ["new tab", "search", "url", "website", "google", "ask", "agent"],
    mac: "Cmd+T",
    windows: "Ctrl+T",
    allowInEditable: true,
    nativeMenu: true,
    allowShadowing: true,
  }),
  command("browser.edit_address", "Edit current address", {
    description: "Reveal the focused website’s address for navigation.",
    category: "Navigation",
    scope: "tool:browser",
    mac: "Cmd+L",
    windows: "Ctrl+L",
    allowInEditable: true,
    allowShadowing: true,
  }),
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
    description: "Sign in to sync, share Spaces and use agents. Browsing works without an account.",
    category: "Misty",
    aliases: ["log in", "account", "create account"],
    allowInEditable: true,
    nativeMenu: true,
  }),
  command("account.sign_out", "Sign out", {
    description: "Sign out of Misty and keep browsing on this device.",
    category: "Misty",
    aliases: ["log out", "account"],
    allowInEditable: true,
    nativeMenu: true,
  }),
  ...focusModeCommands,
  command("app.zoom_in", "Zoom in", {
    description: "Increase the app interface scale.",
    category: "View",
    mac: "Cmd+Plus",
    macAlternate: "Ctrl+Plus",
    windows: "Ctrl+Plus",
    allowInEditable: true,
    repeatable: true,
    nativeMenu: true,
  }),
  command("app.zoom_out", "Zoom out", {
    description: "Decrease the app interface scale.",
    category: "View",
    mac: "Cmd+Minus",
    macAlternate: "Ctrl+Minus",
    windows: "Ctrl+Minus",
    allowInEditable: true,
    repeatable: true,
    nativeMenu: true,
  }),
  command("app.zoom_reset", "Reset zoom", {
    description: "Return the app interface to its default scale.",
    category: "View",
    mac: "Cmd+0",
    macAlternate: "Ctrl+0",
    windows: "Ctrl+0",
    allowInEditable: true,
    nativeMenu: true,
  }),
];

// Each tool keeps its Cmd/Ctrl+Shift number from when there were more tools.
const toolSlots = [["browser", "Browser", 6]] as const;

/** The Space home's tabs, on ⌘1 to ⌘5 while a Space is focused (browser tabs elsewhere). */
const spaceSections = ["Home", "Notes", "Drawings", "Files", "Code"] as const;

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
        category: "Tabs and panes",
        scope: "workspace",
        mac: `Cmd+${index + 1}`,
        windows: `Ctrl+${index + 1}`,
        allowInEditable: true,
      },
    ),
  ),
  ...toolSlots.map(([id, label, slot]) =>
    command(`tool.${id}`, `Open or focus ${label}`, {
      description: `Focus the last ${label} tab or open one in the focused pane.`,
      category: "Jump to tool",
      scope: "workspace",
      aliases: ["jump", "switch tool", label.toLowerCase()],
      mac: `Cmd+Shift+${slot}`,
      windows: `Ctrl+Shift+${slot}`,
      allowInEditable: true,
    }),
  ),
];

export const shortcutCommandRegistry: ShortcutCommandDefinition[] = [
  ...shellCommands,
  ...workspaceCommands,
  ...tabAndToolCommands,
  ...browserCommands,
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
