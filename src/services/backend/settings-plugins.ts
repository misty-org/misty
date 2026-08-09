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
  RemoteEditDraft,
  RemoteTestResult,
  RenderPluginPanelRequest,
  RunPluginCommandRequest,
  SaveRemoteRequest,
  SaveSettingsRequest,
  SaveShortcutsRequest,
  SettingsSnapshot,
  ShortcutsSnapshot,
  VerifyResult,
  VerifyStartRequest,
} from "@/services/misty/model/misty-api";

import { invoke } from "./client";
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

export function shortcutsSnapshot(): Promise<ShortcutsSnapshot> {
  return invoke("shortcuts_snapshot");
}

export function shortcutsSave(request: SaveShortcutsRequest): Promise<ShortcutsSnapshot> {
  return invoke("shortcuts_save", { request });
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
  accessToken: string;
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
