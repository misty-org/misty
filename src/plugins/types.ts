import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";

export type MistyPluginContext = {
  pluginId: string;
  selectedPaths: string[];
  notify: (level: "info" | "success" | "error", title: string, message: string) => void;
  runHostCommand: <T = unknown>(command: string, payload?: Record<string, unknown>) => Promise<T>;
};

export type PluginPanelProps = {
  context: MistyPluginContext;
};

export type PluginPanelDefinition = {
  id: string;
  title: string;
  defaultWidth: number;
  defaultHeight: number;
  component: ComponentType<PluginPanelProps>;
};

export type PluginDefinition = {
  id: string;
  name: string;
  description: string;
  accent: string;
  icon: LucideIcon;
  panels: PluginPanelDefinition[];
};
