import type { useAppStore } from "@/features/app-shell";
import type {
  LaunchOnLoginSnapshot,
  ReassignShortcutRequest,
  ResetShortcutRequest,
  ShortcutsSnapshot,
  UpdateShortcutRequest,
} from "@/native/ipc";

export type SettingsSection =
  | "profiles"
  | "devices"
  | "about"
  | "diagnostics"
  | "browser-downloads"
  | "browser-links"
  | "browser-appearance"
  | "browser-performance"
  | "passwords"
  | "browser-privacy"
  | "browser-permissions"
  | "browser-extensions"
  | "browser-handoff"
  | "browser-import"
  | "spaces-defaults"
  | "spaces-manage"
  | "files-locations"
  | "files-indexing"
  | "agents-defaults"
  | "agents-memory"
  | "agents-connections"
  | "agents-permissions"
  | "agents-coding"
  | "agents-companion"
  | "agents-usage"
  | "voice"
  | "recall"
  | "account"
  | "general"
  | "sync"
  | "appearance"
  | "layout"
  | "shortcuts"
  | "social"
  | "journal"
  | "search"
  | "library"
  | "browser"
  | "terminal"
  | "code"
  | "misty"
  | "agents"
  | "privacy"
  | "server"
  | "updates"
  | "support"
  | "advanced";

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
