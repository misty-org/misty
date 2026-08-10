export type SettingsSection =
  | "general"
  | "app"
  | "agent"
  | "appearance"
  | "notifications"
  | "privacy"
  | "transfers"
  | "search"
  | "shortcuts"
  | "advanced";

export type SettingValue =
  string | number | boolean | Record<string, unknown> | Array<Record<string, unknown>>;

export type SettingsScaleToken = "small" | "default" | "large";
