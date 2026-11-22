import type { useAppStore } from "@/app/shell";
import type {
  LaunchOnLoginSnapshot,
  ReassignShortcutRequest,
  ResetShortcutRequest,
  ShortcutsSnapshot,
  UpdateShortcutRequest,
} from "@/native/ipc";

/** Every Settings section id. */
export const settingsSections = [
  "agent-activity",
  "agents-defaults",
  "agents-permissions",
  "agents-companion",
  "agents-computer-use",
  "pets",
  "bottom-bar",
  "models",
  "voice",
  "devices",
  "account",
  "status",
  "requests",
  "notifications",
  "general",
  "appearance",
  "shortcuts",
  "privacy",
  "server",
  "drive",
  "menu-bar",
  "updates",
  "advanced",
  "fonts",
  "accessibility",
  "network",
  "performance",
  "diagnostics",
  "search",
  "thumbnails",
  // What was the Agents window: the person's agents and their engines.
  "agents-list",
  "engines-clis",
  "engines-channels",
  "engines-environment",
  "engines-usage",
] as const;

export type SettingsSection = (typeof settingsSections)[number];

export type SettingValue =
  string | number | boolean | Record<string, unknown> | Array<Record<string, unknown>>;

export interface SettingsContentProps {
  document: Record<string, unknown>;
  launchOnLogin: LaunchOnLoginSnapshot | null;
  working: boolean;
  onSettingChange: (section: string, key: string, value: SettingValue) => void;
  onLoad: () => Promise<void>;
  onOpenResource?: (path: string) => void;
  onShortcutChange: (request: UpdateShortcutRequest) => Promise<void>;
  onShortcutReassign: (request: ReassignShortcutRequest) => Promise<void>;
  onResetShortcuts: (request?: ResetShortcutRequest) => Promise<void>;
  shortcuts: ShortcutsSnapshot | null;
  app: ReturnType<typeof useAppStore.getState>["app"];
}
