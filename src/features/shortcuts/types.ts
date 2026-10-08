export type ShortcutPlatform = "macos" | "windows" | "linux";

export type ShortcutScope =
  "global" | "workspace" | "tool:browser" | "tool:library" | "tool:planner" | "tool:roadmap";

export interface ShortcutBindingPair {
  primary: string | null;
  alternate: string | null;
}

export interface ShortcutPlatformDefaults {
  macos: ShortcutBindingPair;
  windows: ShortcutBindingPair;
  linux: ShortcutBindingPair;
}

export interface ShortcutCommandDefinition {
  id: string;
  label: string;
  description: string;
  category: string;
  scope: ShortcutScope;
  aliases: string[];
  defaults: ShortcutPlatformDefaults;
  allowInEditable: boolean;
  repeatable: boolean;
  nativeMenu: boolean;
  allowShadowing: boolean;
}
