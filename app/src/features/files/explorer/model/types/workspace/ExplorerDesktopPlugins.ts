import type { PluginCommandEntry, PluginPanelEntry } from "@/native/contracts";

export type PluginMenuItem = {
  pluginId: string;
  pluginName: string;
  panels: PluginPanelEntry[];
  commands: PluginCommandEntry[];
  usable: boolean;
  primaryArea: string;
  kind: "panel" | "commands";
};

export type PluginTabState = {
  kind: "panel" | "commands";
  pluginId: string;
  panelId: string;
  selectedPath: string;
};
