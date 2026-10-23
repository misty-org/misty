import type { ExplorerLocationKind, FileKind } from "@/native/ipc/primitives";
export interface AppSnapshot {
  appName: string;
  version: string;
  environment: AppEnvironmentSnapshot;
}
interface AppEnvironmentSnapshot {
  homeDir: string;
  mistyDir: string;
  configDir: string;
  dbDir: string;
  cacheDir: string;
  tmpDir: string;
  settingsPath: string;
  mistyConfigPath: string;
  commandsPath: string;
  mountPath: string;
  configExists: boolean;
}
export interface MountedDevice {
  id: string;
  volumeId: string;
  name: string;
  mountPath: string;
  fsType: string;
  isRemovable: boolean;
  isSystem: boolean;
  isExternal: boolean;
  isNetwork: boolean;
  writable: boolean;
  totalBytes: number;
  freeBytes: number;
}
export interface DeviceSnapshot {
  devices: MountedDevice[];
}
export interface ExplorerLocation {
  kind: ExplorerLocationKind;
  providerType: string | null;
  remoteName: string | null;
  remotePath: string | null;
}
export interface FileEntry {
  id: string;
  name: string;
  path: string;
  extension: string;
  mimeType: string | null;
  remoteModified: string | null;
  kind: FileKind;
  sizeBytes: number | null;
  modifiedMs: number | null;
  createdMs: number | null;
  readonly: boolean;
  hidden: boolean;
  isDeleted?: boolean;
  location: ExplorerLocation;
}
