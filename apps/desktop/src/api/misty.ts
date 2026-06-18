import { invoke } from "@tauri-apps/api/core";
import type {
  AppSnapshot,
  AppEnvironmentSnapshot,
  DirectoryListing,
  ListDirectoryRequest,
  ProviderRemote,
  ProvidersSnapshot,
  ProxySnapshot,
  RcloneConfigPaths,
  RemoteEditDraft,
  RemoteTestResult,
  SaveSettingsRequest,
  SaveRemoteRequest,
  SaveShortcutsRequest,
  SettingsSnapshot,
  ShortcutsSnapshot,
  TransferFilter,
  TransferPage,
} from "./types";

export function appSnapshot(): Promise<AppSnapshot> {
  return invoke("app_snapshot");
}

export function appEnvironmentSnapshot(): Promise<AppEnvironmentSnapshot> {
  return invoke("app_environment_snapshot");
}

export function proxySnapshot(): Promise<ProxySnapshot> {
  return invoke("proxy_snapshot");
}

export function explorerListDirectory(request: ListDirectoryRequest): Promise<DirectoryListing> {
  return invoke("explorer_list_directory", { request });
}

export function settingsSnapshot(): Promise<SettingsSnapshot> {
  return invoke("settings_snapshot");
}

export function settingsSave(request: SaveSettingsRequest): Promise<SettingsSnapshot> {
  return invoke("settings_save", { request });
}

export function shortcutsSnapshot(): Promise<ShortcutsSnapshot> {
  return invoke("shortcuts_snapshot");
}

export function shortcutsSave(request: SaveShortcutsRequest): Promise<ShortcutsSnapshot> {
  return invoke("shortcuts_save", { request });
}

export function providersSnapshot(): Promise<ProvidersSnapshot> {
  return invoke("providers_snapshot");
}

export function providersRefresh(): Promise<ProvidersSnapshot> {
  return invoke("providers_refresh");
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

export function providersConfigPaths(): Promise<RcloneConfigPaths> {
  return invoke("providers_config_paths");
}

export function transfersSnapshot(filter: TransferFilter = {}): Promise<TransferPage> {
  return invoke("transfers_snapshot", { filter });
}

export function transfersDeleteSelected(ids: number[]): Promise<void> {
  return invoke("transfers_delete_selected", { ids });
}

export function transfersDeleteAll(): Promise<void> {
  return invoke("transfers_delete_all");
}

export function remoteDisplayName(remote: ProviderRemote): string {
  return remote.name || "(unnamed remote)";
}
