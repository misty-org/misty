import { pluginCommandsSnapshot } from "@/features/files/native";
import type { PluginCommandEntry, PluginPanelEntry } from "@/native/contracts";
import {
  defaultBindingsFor,
  registerShortcutCommandDefinition,
  type ShortcutCommandDefinition,
} from "@/features/shortcuts";
import { useSettingsStore } from "@/features/settings";
import { useEffect, useRef, useState } from "react";
import { executableShortcutCommands } from "../ExplorerCommands";
import { emptyPluginCommands, emptyPluginPanels } from "../ExplorerWorkspaceConstants";
import { pluginCommandsEqual, pluginPanelsEqual } from "../ExplorerWorkspaceUtils";

/**
 * Plugin commands and panels, plus the shortcut map they extend.
 *
 * Extensions can be installed while Misty is running, so this reloads on window
 * focus. A plugin's `defaultShortcut` only applies where the user has not bound
 * that command themselves.
 */
export function usePluginRegistry(options: { extensionsEnabled: boolean }) {
  const { extensionsEnabled } = options;
  const [pluginCommands, setPluginCommands] = useState<PluginCommandEntry[]>(emptyPluginCommands);
  const [pluginPanels, setPluginPanels] = useState<PluginPanelEntry[]>(emptyPluginPanels);
  const executableCommandIdsRef = useRef<readonly string[]>(executableShortcutCommands);
  const pluginCommandsRef = useRef<PluginCommandEntry[]>(emptyPluginCommands);
  const unregisterPluginDefinitionsRef = useRef<Array<() => void>>([]);

  useEffect(() => {
    if (!extensionsEnabled) {
      executableCommandIdsRef.current = executableShortcutCommands;
      pluginCommandsRef.current = emptyPluginCommands;
      setPluginCommands(emptyPluginCommands);
      setPluginPanels(emptyPluginPanels);
      return;
    }
    let disposed = false;
    const loadCommandMetadata = async () => {
      try {
        const pluginSnapshot = await pluginCommandsSnapshot();
        if (!disposed) {
          unregisterPluginDefinitionsRef.current.forEach((remove) => remove());
          const pluginDefinitions = pluginSnapshot.commands.map(pluginShortcutDefinition);
          unregisterPluginDefinitionsRef.current = pluginDefinitions.map(
            registerShortcutCommandDefinition,
          );
          appendPluginDefinitionsToSettings(pluginDefinitions);
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
      unregisterPluginDefinitionsRef.current.forEach((remove) => remove());
      unregisterPluginDefinitionsRef.current = [];
    };
  }, [extensionsEnabled]);

  return {
    pluginCommands,
    pluginPanels,
    executableCommandIdsRef,
    pluginCommandsRef,
  };
}

function pluginShortcutDefinition(pluginCommand: PluginCommandEntry): ShortcutCommandDefinition {
  const defaultShortcut = pluginCommand.defaultShortcut || null;
  return {
    id: pluginCommand.id,
    label: pluginCommand.label,
    description: pluginCommand.hint || `Run ${pluginCommand.label}.`,
    category: pluginCommand.pluginName || "Extensions",
    scope: "tool:files",
    aliases: [pluginCommand.pluginName, pluginCommand.pluginId],
    defaults: {
      macos: { primary: defaultShortcut, alternate: null },
      windows: { primary: nonMacPluginShortcut(defaultShortcut), alternate: null },
      linux: { primary: nonMacPluginShortcut(defaultShortcut), alternate: null },
    },
    allowInEditable: false,
    repeatable: false,
    nativeMenu: false,
    allowShadowing: false,
  };
}

function nonMacPluginShortcut(shortcut: string | null): string | null {
  return (
    shortcut?.replace(/\b(?:command|cmd|meta)\b/gi, "Ctrl").replace(/\boption\b/gi, "Alt") ?? null
  );
}

function appendPluginDefinitionsToSettings(definitions: ShortcutCommandDefinition[]) {
  useSettingsStore.setState((state) => {
    const snapshot = state.shortcuts;
    if (!snapshot) return state;
    const existingIds = new Set(snapshot.commandDefinitions.map((definition) => definition.id));
    const additions = definitions.filter((definition) => !existingIds.has(definition.id));
    if (!additions.length) return state;
    const overrides = new Map(snapshot.overrides.map((entry) => [entry.commandId, entry]));
    const effectiveBindings = additions.map((definition) => {
      const defaults = defaultBindingsFor(definition, snapshot.detectedPlatform);
      const override = overrides.get(definition.id);
      return {
        commandId: definition.id,
        primary: override?.primary !== undefined ? override.primary : defaults.primary,
        alternate: override?.alternate !== undefined ? override.alternate : defaults.alternate,
        primarySource: override?.primary !== undefined ? ("user" as const) : ("default" as const),
        alternateSource:
          override?.alternate !== undefined ? ("user" as const) : ("default" as const),
      };
    });
    return {
      shortcuts: {
        ...snapshot,
        commandDefinitions: [...snapshot.commandDefinitions, ...additions],
        effectiveBindings: [...snapshot.effectiveBindings, ...effectiveBindings],
      },
    };
  });
}
