export type SettingsSection =
  | "general"
  | "app"
  | "agent"
  | "appearance"
  | "privacy"
  | "transfers"
  | "search"
  | "shortcuts"
  | "advanced";

export type SettingValue =
  string | number | boolean | Record<string, unknown> | Array<Record<string, unknown>>;
