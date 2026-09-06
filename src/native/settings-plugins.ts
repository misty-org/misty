import type {
  DefaultBrowserSnapshot,
  LaunchOnLoginSnapshot,
  NativeShortcutsSnapshot,
  SaveSettingsRequest,
  SettingsSnapshot,
  ShortcutsSnapshot,
} from "@/native/ipc";
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

export function settingsDefaultBrowserSnapshot(): Promise<DefaultBrowserSnapshot> {
  return invoke("settings_default_browser_snapshot");
}

/** macOS confirms the change itself; re-read the snapshot when the window regains focus. */
export function settingsRequestDefaultBrowser(): Promise<DefaultBrowserSnapshot> {
  return invoke("settings_request_default_browser");
}

export async function shortcutsSnapshot(): Promise<ShortcutsSnapshot> {
  return hydrateShortcutsSnapshot(await invoke<NativeShortcutsSnapshot>("shortcuts_snapshot"));
}

export async function shortcutsReplace(
  overrides: NativeShortcutsSnapshot["overrides"],
): Promise<ShortcutsSnapshot> {
  return hydrateShortcutsSnapshot(
    await invoke<NativeShortcutsSnapshot>("shortcuts_replace", { overrides }),
  );
}

/** Resolves bindings in the webview, so an override takes effect before native persistence. */
export function hydrateShortcutsSnapshot(snapshot: NativeShortcutsSnapshot): ShortcutsSnapshot {
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
    .filter(
      (definition) =>
        definition.scope === "global" ||
        definition.scope === "workspace" ||
        definition.scope === "tool:browser",
    )
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
