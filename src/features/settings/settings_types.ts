import type { useAppStore } from "@/app/shell";
import type {
  LaunchOnLoginSnapshot,
  ReassignShortcutRequest,
  ResetShortcutRequest,
  ShortcutsSnapshot,
  UpdateShortcutRequest,
} from "@/native/ipc";

export const settingsSections = [
  "account",
  "status",
  "sessions",
  "account-removal",
  "requests",
  "privacy",
  "apps-data",
  "server",
  "drive",
  "thumbnails",
  "general",
  "menu-bar",
  "notifications",
  "search",
  "browser",
  "updates",
  "appearance",
  "display",
  "accessibility",
  "fonts",
  "bottom-bar",
  "pets",
  "voice",
  "speech",
  "speaking",
  "listening",
  "devices",
  "voice-models",
  "shortcuts",
  "network",
  "advanced",
  "performance",
  "diagnostics",
  "agents-list",
  "agents-defaults",
  "agents-screens",
  "agent-activity",
  "agents-permissions",
  "agents-approvals",
  "agents-folders",
  "agents-sandbox",
  "agents-disk",
  "agents-computer-use",
  "agents-companion",
  "tutor-behavior",
  "tutor-talking",
  "tutor-tour",
  "models",
  "engines-clis",
  "engines-channels",
  "engines-environment",
  "engines-usage",
  "engines-limits",
  "engines-logs",
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
