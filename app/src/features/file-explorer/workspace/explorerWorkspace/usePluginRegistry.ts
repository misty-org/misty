import { pluginCommandsSnapshot, shortcutsSnapshot } from "@/services/backend";
import type { PluginCommandEntry, PluginPanelEntry } from "@/services/misty/model/misty-api";
import { shortcutMapFromBindings } from "@/shared/lib/shortcuts";
import { useEffect, useRef, useState } from "react";
import { defaultExplorerShortcutMap, executableShortcutCommands } from "../ExplorerCommands";
import { emptyPluginCommands, emptyPluginPanels } from "../ExplorerWorkspaceConstants";
import { pluginCommandsEqual, pluginPanelsEqual } from "../ExplorerWorkspaceUtils";

/**
 * Plugin commands and panels, plus the shortcut map they extend.
 *
 * Extensions can be installed while Misty is running, so this reloads on window
 * focus. A plugin's `defaultShortcut` only applies where the user has not bound
 * that command themselves.
 */
export function usePluginRegistry(options: {
  extensionsEnabled: boolean;
  shortcutPreferences: { customShortcutsEnabled: boolean; keymapIndex: number };
}) {
  const { extensionsEnabled, shortcutPreferences } = options;
  const [pluginCommands, setPluginCommands] = useState<PluginCommandEntry[]>(emptyPluginCommands);
  const [pluginPanels, setPluginPanels] = useState<PluginPanelEntry[]>(emptyPluginPanels);
  const shortcutMapRef = useRef(defaultExplorerShortcutMap(shortcutPreferences.keymapIndex));
  const executableCommandIdsRef = useRef<readonly string[]>(executableShortcutCommands);
  const pluginCommandsRef = useRef<PluginCommandEntry[]>(emptyPluginCommands);

  useEffect(() => {
    if (!extensionsEnabled) {
      shortcutMapRef.current = defaultExplorerShortcutMap(shortcutPreferences.keymapIndex);
      executableCommandIdsRef.current = executableShortcutCommands;
      pluginCommandsRef.current = emptyPluginCommands;
      setPluginCommands(emptyPluginCommands);
      setPluginPanels(emptyPluginPanels);
      return;
    }
    let disposed = false;
    const loadCommandMetadata = async () => {
      try {
        const [shortcutSnapshot, pluginSnapshot] = await Promise.all([
          shortcutsSnapshot(),
          pluginCommandsSnapshot(),
        ]);
        if (!disposed) {
          const fallbackShortcuts = defaultExplorerShortcutMap(shortcutPreferences.keymapIndex);
          const shortcutMap = shortcutPreferences.customShortcutsEnabled
            ? shortcutMapFromBindings(shortcutSnapshot.bindings, fallbackShortcuts)
            : fallbackShortcuts;
          for (const command of pluginSnapshot.commands) {
            if (command.defaultShortcut && !shortcutMap[command.id]) {
              shortcutMap[command.id] = command.defaultShortcut;
            }
          }
          shortcutMapRef.current = shortcutMap;
          executableCommandIdsRef.current = [
            ...executableShortcutCommands,
            ...pluginSnapshot.commands.map((command) => command.id),
          ];
          pluginCommandsRef.current = pluginSnapshot.commands;
          setPluginCommands((current) =>
            pluginCommandsEqual(current, pluginSnapshot.commands)
              ? current
              : pluginSnapshot.commands,
          );
          setPluginPanels((current) =>
            pluginPanelsEqual(current, pluginSnapshot.panels) ? current : pluginSnapshot.panels,
          );
        }
      } catch {
        if (!disposed) {
          shortcutMapRef.current = defaultExplorerShortcutMap(shortcutPreferences.keymapIndex);
          executableCommandIdsRef.current = executableShortcutCommands;
          pluginCommandsRef.current = emptyPluginCommands;
          setPluginCommands((current) => (current.length === 0 ? current : emptyPluginCommands));
          setPluginPanels((current) => (current.length === 0 ? current : emptyPluginPanels));
        }
      }
    };
    void loadCommandMetadata();
    window.addEventListener("focus", loadCommandMetadata);
    return () => {
      disposed = true;
      window.removeEventListener("focus", loadCommandMetadata);
    };
  }, [
    extensionsEnabled,
    shortcutPreferences.customShortcutsEnabled,
    shortcutPreferences.keymapIndex,
  ]);

  return {
    pluginCommands,
    pluginPanels,
    shortcutMapRef,
    executableCommandIdsRef,
    pluginCommandsRef,
  };
}
