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
  "agents-personas",
  "agents-computer-use",
  "pets",
  "bottom-bar",
  "models",
  "voice",
  "account",
  "general",
  "appearance",
  "shortcuts",
  "privacy",
  "server",
  "updates",
  "advanced",
  "engine-clis",
  "engine-channels",
  "engine-env",
  "engine-usage",
  "engine-mcp",
  "engine-skills",
  "engine-prompts",
  "fonts",
  "network",
  "performance",
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
