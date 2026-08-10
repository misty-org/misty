import type { PluginCommandEntry, PluginPanelEntry } from "@/services/misty/model/misty-api";
import type { PluginMenuItem } from "../../model/types/workspace/ExplorerDesktopPlugins";
import {
  pluginCommandNeedsSelection,
  pluginCommandOnlyOpensLauncher,
} from "./PluginPanelElementView";

// The desktop Explorer only ever hosts "files"-area panels today.
const currentPluginArea = "files";

export function pluginMenuItems(
  panels: PluginPanelEntry[],
  commands: PluginCommandEntry[],
  selectedPath: string,
): PluginMenuItem[] {
  const grouped = new Map<string, PluginMenuItem>();
  for (const panel of panels) {
    const item =
      grouped.get(panel.pluginId) ?? createPluginMenuItem(panel.pluginId, panel.pluginName);
    item.panels.push(panel);
    item.pluginName = panel.pluginName || item.pluginName;
    grouped.set(panel.pluginId, item);
  }
  for (const command of commands) {
    if (pluginCommandOnlyOpensLauncher(command)) continue;
    const item =
      grouped.get(command.pluginId) ?? createPluginMenuItem(command.pluginId, command.pluginName);
    item.commands.push(command);
    item.pluginName = command.pluginName || item.pluginName;
    grouped.set(command.pluginId, item);
  }

  return Array.from(grouped.values())
    .map((item) => {
      const usablePanels = item.panels.filter(pluginPanelUsableInCurrentArea);
      const usableCommands = item.commands.filter(
        (command) => !pluginCommandNeedsSelection(command, selectedPath),
      );
      const primaryPanel = usablePanels[0] ?? item.panels[0];
      const primaryArea = primaryPanel?.launcherViews[0] ?? "Other";
      return {
        ...item,
        panels: item.panels.slice().sort((left, right) => left.title.localeCompare(right.title)),
        commands: item.commands
          .slice()
          .sort((left, right) => left.label.localeCompare(right.label)),
        usable: usablePanels.length > 0 || usableCommands.length > 0,
        primaryArea,
        kind: primaryPanel ? ("panel" as const) : ("commands" as const),
      };
    })
    .sort(
      (left, right) =>
        Number(right.usable) - Number(left.usable) ||
        left.pluginName.localeCompare(right.pluginName),
    );
}

export function createPluginMenuItem(pluginId: string, pluginName: string): PluginMenuItem {
  return {
    pluginId,
    pluginName: pluginName || pluginId,
    panels: [],
    commands: [],
    usable: false,
    primaryArea: "Other",
    kind: "commands",
  };
}

export function filterPluginMenuItems(items: PluginMenuItem[], query: string): PluginMenuItem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return items;
  return items.filter((item) =>
    [
      item.pluginId,
      item.pluginName,
      item.primaryArea,
      ...item.panels.flatMap((panel) => [panel.id, panel.title, panel.launcherViews.join(" ")]),
      ...item.commands.flatMap((command) => [command.id, command.label, command.hint]),
    ]
      .join(" ")
      .toLowerCase()
      .includes(needle),
  );
}

export function pluginPanelUsableInCurrentArea(panel: PluginPanelEntry): boolean {
  if (panel.launcherViews.length === 0) return true;
  return panel.launcherViews.some((view) => {
    const area = normalizedPluginArea(view);
    return area === "all" || area === currentPluginArea;
  });
}

export function normalizedPluginArea(area: string): string {
  const normalized = area.trim().toLowerCase();
  if (normalized === "explorer") return "files";
  return normalized;
}

export function stringArraysEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

export function extensionAreaLabel(area: string): string {
  return normalizedPluginArea(area) === "plugins" ? "Extensions" : area;
}

export function pluginMenuSubtitle(plugin: PluginMenuItem): string {
  const panelCount = plugin.panels.length;
  const commandCount = plugin.commands.length;
  if (panelCount && commandCount)
    return `${panelCount} panel${panelCount === 1 ? "" : "s"} · ${commandCount} command${commandCount === 1 ? "" : "s"}`;
  if (panelCount) return `${panelCount} panel${panelCount === 1 ? "" : "s"}`;
  return `${commandCount} command${commandCount === 1 ? "" : "s"}`;
}
