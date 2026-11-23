// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import {
  canInvokeShortcutCommand,
  invokeShortcutCommand,
  shortcutCommandRegistry,
} from "@/features/shortcuts";
import { commandRegistry } from "./command_registry";

const hidden = new Set(["app.command_palette"]);

export function registerBuiltinCommands() {
  for (const definition of shortcutCommandRegistry) {
    if (hidden.has(definition.id)) continue;
    commandRegistry.register({
      id: `shortcut:${definition.id}`,
      title: () => definition.label,
      keywords: () => [definition.category, ...definition.aliases],
      shortcutId: definition.id,
      available: () => canInvokeShortcutCommand(definition.id),
      run: () => requestAnimationFrame(() => void invokeShortcutCommand(definition.id)),
    });
  }
  if (import.meta.env.DEV) {
    commandRegistry.register({
      id: "dev:try-every-engine",
      title: () => "Try the engine test on every engine",
      keywords: () => ["engines", "test", "compare", "chess"],
      run: () =>
        void import("@/features/agents")
          .then((agents) => agents.tryEveryEngine())
          .catch(() => undefined),
    });
  }
}
