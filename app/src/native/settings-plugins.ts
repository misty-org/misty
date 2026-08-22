import type {
  CloudConfigPaths,
  ExtensionCommandRequest,
  LaunchOnLoginSnapshot,
  OpenWithAssociation,
  PluginCommandRunResult,
  PluginCommandsSnapshot,
  PluginDiagnosticsSnapshot,
  PluginPanelRenderResult,
  ProviderConfigRequest,
  ProviderConfigStep,
  ProviderJobStart,
  ProviderJobStatus,
  ProvidersSnapshot,
  NativeShortcutsSnapshot,
  ReassignShortcutRequest,
  RemoteEditDraft,
  RemoteTestResult,
  RenderPluginPanelRequest,
  RunPluginCommandRequest,
  SaveRemoteRequest,
  SaveSettingsRequest,
  ResetShortcutRequest,
  SettingsSnapshot,
  ShortcutsSnapshot,
  UpdateShortcutRequest,
  VerifyResult,
  VerifyStartRequest,
} from "@/native/contracts";
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

export function pluginCommandsSnapshot(): Promise<PluginCommandsSnapshot> {
  return invoke("plugin_commands_snapshot");
}

export function pluginCommandRun(
  request: RunPluginCommandRequest,
): Promise<PluginCommandRunResult> {
  return invoke("plugin_command_run", { request });
}

export function pluginPanelRender(
  request: RenderPluginPanelRequest,
): Promise<PluginPanelRenderResult> {
  return invoke("plugin_panel_render", { request });
}

export function extensionCommandRun<T = unknown>(request: ExtensionCommandRequest): Promise<T> {
  return invoke("extension_command_run", { request });
}

export function pluginDiagnosticsSnapshot(): Promise<PluginDiagnosticsSnapshot> {
  return invoke("plugin_diagnostics_snapshot");
}

export function openExternalUrl(url: string): Promise<void> {
  return invoke("open_external_url", { url });
}

export function providersSnapshot(): Promise<ProvidersSnapshot> {
  return invoke("providers_snapshot");
}

export function providersRefresh(): Promise<ProvidersSnapshot> {
  return invoke("providers_refresh");
}

export function providersImportCloudConnection(request: {
  name: string;
  providerType: string;
  connectionId: string;
  connectionSource?: "connected_account" | "legacy_cloud";
  connectedAccountId?: string;
  handoff: string;
  redeemUrl: string;
}): Promise<ProvidersSnapshot> {
  return invoke("providers_import_cloud_connection", request);
}

export function providersSelectRemote(name: string): Promise<RemoteEditDraft> {
  return invoke("providers_select_remote", { name });
}

export function providersSaveRemote(request: SaveRemoteRequest): Promise<RemoteEditDraft> {
  return invoke("providers_save_remote", { request });
}

export function providersTestRemote(name: string): Promise<RemoteTestResult> {
  return invoke("providers_test_remote", { name });
}

export function providersConfigPaths(): Promise<CloudConfigPaths> {
  return invoke("providers_config_paths");
}

export function providersConfigureRemote(
  request: ProviderConfigRequest,
): Promise<ProviderConfigStep> {
  return invoke("providers_configure_remote", { request });
}

export function providersVerifyStart(request: VerifyStartRequest): Promise<ProviderJobStart> {
  return invoke("providers_verify_start", { request });
}

export function providersJobStatus(jobId: string): Promise<ProviderJobStatus> {
  return invoke("providers_job_status", { jobId });
}

export function providersJobCancel(jobId: string): Promise<unknown> {
  return invoke("providers_job_cancel", { jobId });
}

export function providersVerifyResult(jobId: string): Promise<VerifyResult> {
  return invoke("providers_verify_result", { jobId });
}

export function providersDisconnectRemote(name: string): Promise<ProvidersSnapshot> {
  return invoke("providers_disconnect_remote", { name });
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
