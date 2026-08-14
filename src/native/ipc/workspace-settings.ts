// eslint-disable-next-line no-restricted-imports -- these transport types are owned by the shortcut registry
import type { ShortcutCommandDefinition, ShortcutPlatform } from "@/features/shortcuts/registry";
// eslint-disable-next-line no-restricted-imports -- shortcut slots are shared with native persistence
import type { ShortcutSlot } from "@/features/shortcuts/bindings";

export interface SettingsSnapshot {
  path: string;
  document: Record<string, unknown>;
}

export interface LaunchOnLoginSnapshot {
  supported: boolean;
  enabled: boolean;
  target: string;
  detail: string;
}

export interface OpenWithAssociation {
  key: string;
  applicationPath: string;
}

export interface SaveSettingsRequest {
  document: Record<string, unknown>;
}

export interface NativeShortcutOverride {
  commandId: string;
  primary?: string | null;
  alternate?: string | null;
}

export interface NativeShortcutsSnapshot {
  path: string;
  overrides: NativeShortcutOverride[];
}

export interface ShortcutBindingSet {
  commandId: string;
  primary: string | null;
  alternate: string | null;
  primarySource: "default" | "user";
  alternateSource: "default" | "user";
}

/** @deprecated Use effectiveBindings. Kept while focused tools move to the dispatcher. */
export interface ShortcutBinding {
  commandId: string;
  shortcut: string;
  source: "default" | "user";
}

export interface ShortcutsSnapshot {
  detectedPlatform: ShortcutPlatform;
  profileName: string;
  commandDefinitions: ShortcutCommandDefinition[];
  effectiveBindings: ShortcutBindingSet[];
  bindings: ShortcutBinding[];
  configPath: string;
  overrides: NativeShortcutOverride[];
}

export interface UpdateShortcutRequest {
  commandId: string;
  slot: ShortcutSlot;
  value: string | null;
}

export interface ReassignShortcutRequest extends UpdateShortcutRequest {
  conflictingCommandId: string;
  conflictingSlot: ShortcutSlot;
}

export interface ResetShortcutRequest {
  commandId?: string;
  commandIds?: string[];
}
