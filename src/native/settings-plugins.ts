import type {
  LaunchOnLoginSnapshot,
  NativeShortcutsSnapshot,
  OpenWithAssociation,
  ReassignShortcutRequest,
  ResetShortcutRequest,
  SaveSettingsRequest,
  SettingsSnapshot,
  ShortcutsSnapshot,
  UpdateShortcutRequest,
} from "@/native/ipc";
import { openExternalLink } from "@/shared/platform/openExternalLink";
// eslint-disable-next-line no-restricted-imports -- shortcut hydration is the adapter boundary for the native snapshot
import { detectShortcutPlatform, normalizeShortcut } from "@/features/shortcuts/bindings";
// eslint-disable-next-line no-restricted-imports -- the registry supplies transport-neutral command metadata
import { defaultBindingsFor, shortcutCommandRegistry } from "@/features/shortcuts/registry";

import { invoke } from "./invoke";
export function settingsSnapshot(): Promise<SettingsSnapshot> {
  return invoke("settings_snapshot");
}

export function settingsSave(request: SaveSettingsRequest): Promise<SettingsSnapshot> {
  return invoke("settings_save", { request });
}

export function settingsLaunchOnLoginSnapshot(): Promise<LaunchOnLoginSnapshot> {
  return invoke("settings_launch_on_login_snapshot");
}

export function settingsApplyLaunchOnLogin(enabled: boolean): Promise<LaunchOnLoginSnapshot> {
  return invoke("settings_apply_launch_on_login", { enabled });
}

export function settingsOpenWithAssociations(): Promise<OpenWithAssociation[]> {
  return invoke("settings_open_with_associations");
}

export function settingsRemoveOpenWithAssociation(key: string): Promise<SettingsSnapshot> {
  return invoke("settings_remove_open_with_association", { key });
}

export async function shortcutsSnapshot(): Promise<ShortcutsSnapshot> {
  return hydrateShortcutsSnapshot(await invoke<NativeShortcutsSnapshot>("shortcuts_snapshot"));
}

export async function shortcutsReset(
  request: ResetShortcutRequest = {},
): Promise<ShortcutsSnapshot> {
  return hydrateShortcutsSnapshot(
    await invoke<NativeShortcutsSnapshot>("shortcuts_reset", { request }),
  );
}

export async function shortcutsUpdate(request: UpdateShortcutRequest): Promise<ShortcutsSnapshot> {
  return hydrateShortcutsSnapshot(
    await invoke<NativeShortcutsSnapshot>("shortcuts_update", { request }),
  );
}

export async function shortcutsReassign(
  request: ReassignShortcutRequest,
): Promise<ShortcutsSnapshot> {
  return hydrateShortcutsSnapshot(
    await invoke<NativeShortcutsSnapshot>("shortcuts_reassign", { request }),
  );
}

function hydrateShortcutsSnapshot(snapshot: NativeShortcutsSnapshot): ShortcutsSnapshot {
  const detectedPlatform = detectShortcutPlatform();
  const overrides = new Map(snapshot.overrides.map((entry) => [entry.commandId, entry]));
  const effectiveBindings = shortcutCommandRegistry.map((definition) => {
    const defaults = defaultBindingsFor(definition, detectedPlatform);
    const override = overrides.get(definition.id);
    return {
      commandId: definition.id,
      primary: override?.primary !== undefined ? override.primary : defaults.primary,
      alternate: override?.alternate !== undefined ? override.alternate : defaults.alternate,
      primarySource: override?.primary !== undefined ? ("user" as const) : ("default" as const),
      alternateSource: override?.alternate !== undefined ? ("user" as const) : ("default" as const),
    };
  });
  const hydrated: ShortcutsSnapshot = {
    detectedPlatform,
    profileName:
      detectedPlatform === "macos" ? "macOS" : detectedPlatform === "windows" ? "Windows" : "Linux",
    commandDefinitions: [...shortcutCommandRegistry],
    effectiveBindings,
    bindings: effectiveBindings.flatMap((binding) =>
      binding.primary
        ? [
            {
              commandId: binding.commandId,
              shortcut: binding.primary,
              source: binding.primarySource,
            },
          ]
        : [],
    ),
    configPath: snapshot.path,
    overrides: snapshot.overrides,
  };
  const forwarded = hydrated.commandDefinitions
    .filter((definition) => definition.scope === "global" || definition.scope === "workspace")
    .flatMap((definition) => {
      const binding = hydrated.effectiveBindings.find(
        (candidate) => candidate.commandId === definition.id,
      );
      return [binding?.primary, binding?.alternate]
        .map(normalizeShortcut)
        .filter((value): value is string => Boolean(value))
        .map((shortcut) => ({ shortcut, allowInEditable: definition.allowInEditable }));
    });
  const forwardedByShortcut = new Map<string, { shortcut: string; allowInEditable: boolean }>();
  for (const binding of forwarded) {
    const current = forwardedByShortcut.get(binding.shortcut);
    forwardedByShortcut.set(binding.shortcut, {
      shortcut: binding.shortcut,
      allowInEditable: binding.allowInEditable || Boolean(current?.allowInEditable),
    });
  }
  void invoke("browser_shortcuts_update", { bindings: [...forwardedByShortcut.values()] }).catch(
    () => undefined,
  );
  return hydrated;
}

export function openExternalUrl(url: string): Promise<void> {
  return openExternalLink(url);
}

export function codingAiReadApiKey(providerId: string): Promise<string | null> {
  return invoke("coding_ai_read_api_key", { providerId });
}

export function codingAiWriteApiKey(providerId: string, key: string): Promise<void> {
  return invoke("coding_ai_write_api_key", { providerId, key });
}

export function codingAiClearApiKey(providerId: string): Promise<void> {
  return invoke("coding_ai_clear_api_key", { providerId });
}
