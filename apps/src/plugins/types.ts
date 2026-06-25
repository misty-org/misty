import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";

export type MistyPluginContext = {
  pluginId: string;
  selectedPaths: string[];
  hosted: boolean;
  refreshSelection: () => Promise<string[]>;
  notify: (level: "info" | "success" | "error", title: string, message: string) => void;
  runHostCommand: <T = unknown>(command: string, payload?: Record<string, unknown>) => Promise<T>;
  theme: ThemeSnapshot;
};

export type ThemeMode = "dark" | "light";
export type SemanticThemeToken =
  | "background" | "surface" | "surfaceRaised" | "surfaceHover" | "border"
  | "borderStrong" | "text" | "textMuted" | "textSubtle" | "primary"
  | "primaryContrast" | "accent" | "focus" | "selection" | "success"
  | "warning" | "danger" | "info" | "shadow";

export type ThemeSnapshot = {
  themeId: string;
  mode: ThemeMode;
  revision: number;
  tokens: Record<SemanticThemeToken, string>;
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
