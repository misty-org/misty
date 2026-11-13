import type { ShortcutCommandDefinition, ShortcutPlatform } from "@/shared/shortcuts/registry";
import type { ShortcutSlot } from "@/shared/shortcuts/bindings";

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
export interface SaveSettingsRequest {
  document: Record<string, unknown>;
}

interface NativeShortcutOverride {
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

export interface ShortcutsSnapshot {
  detectedPlatform: ShortcutPlatform;
  commandDefinitions: ShortcutCommandDefinition[];
  effectiveBindings: ShortcutBindingSet[];
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
