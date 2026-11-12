import type { useAppStore } from "@/app/shell";
import type {
  LaunchOnLoginSnapshot,
  ReassignShortcutRequest,
  ResetShortcutRequest,
  ShortcutsSnapshot,
  UpdateShortcutRequest,
} from "@/native/ipc";

/** Every Settings section id, including retired ones that resolve elsewhere (settingsRouting.ts). */
export const settingsSections = [
  "profiles",
  "devices",
  "about",
  "diagnostics",
  "browser-downloads",
  "browser-links",
  "browser-appearance",
  "browser-tabs",
  "passwords",
  "autofill",
  "browser-privacy",
  "browser-permissions",
  "agent-activity",
  "browser-signins",
  "browser-extensions",
  "browser-handoff",
  "browser-import",
  "spaces-defaults",
  "spaces-manage",
  "files-locations",
  "files-indexing",
  "agents-defaults",
  "agents-permissions",
  "agents-companion",
  "agents-personas",
  "agents-computer-use",
  "pets",
  "models",
  "voice",
  "account",
  "general",
  "sync",
  "appearance",
  "layout",
  "shortcuts",
  "social",
  "journal",
  "search",
  "library",
  "browser",
  "terminal",
  "misty",
  "agents",
  "privacy",
  "server",
  "updates",
  "support",
  "advanced",
  "engine-clis",
  "engine-channels",
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
