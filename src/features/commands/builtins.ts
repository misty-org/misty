// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import {
  canInvokeShortcutCommand,
  invokeShortcutCommand,
  shortcutCommandRegistry,
} from "@/features/shortcuts";
import { commandRegistry } from "./commandRegistry";

/** Commands the palette leaves out: opening the palette itself. */
const hidden = new Set(["app.command_palette"]);

/**
 * Every command in the shortcut registry is a palette row too, the chat's included, found by its
 * label and aliases and run as its shortcut would be. A command with no handler mounted (a chat that
 * isn't on screen) is left out. Runs once, when the palette first loads; registering again
 * replaces the same rows.
 */
export function registerBuiltinCommands() {
  for (const definition of shortcutCommandRegistry) {
    if (hidden.has(definition.id)) continue;
    commandRegistry.register({
      id: `shortcut:${definition.id}`,
      title: () => definition.label,
      keywords: () => [definition.category, ...definition.aliases],
      shortcutId: definition.id,
      available: () => canInvokeShortcutCommand(definition.id),
      // After the palette closes and focus returns, so commands that refuse to run in a field work.
      run: () => requestAnimationFrame(() => void invokeShortcutCommand(definition.id)),
    });
  }
}
