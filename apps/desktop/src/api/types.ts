export type ApiResult<T> = Promise<T>;

export interface AppSnapshot {
  appName: string;
  migrationStage: string;
  proxyUrl: string | null;
  environment: AppEnvironmentSnapshot;
}

export interface AppEnvironmentSnapshot {
  homeDir: string;
  mistyDir: string;
  configDir: string;
  dbDir: string;
  cacheDir: string;
  tmpDir: string;
  assetsDir: string;
  pluginsPublicDir: string;
  pluginsPrivateDir: string;
  settingsPath: string;
  mistyConfigPath: string;
  workspacesPath: string;
  commandsPath: string;
  proxyUrl: string | null;
  serverUrl: string | null;
  grpcAddress: string;
  mountPath: string;
  configExists: boolean;
  derivedEnv: Record<string, string>;
}

export interface ProxySnapshot {
  proxyUrl: string | null;
  ready: boolean;
  statusCode: number | null;
  error: string | null;
}

export type FileKind = "folder" | "file" | "symlink" | "other";

export interface FileEntry {
  id: string;
  name: string;
  path: string;
  extension: string;
  kind: FileKind;
  sizeBytes: number | null;
  modifiedMs: number | null;
  createdMs: number | null;
  readonly: boolean;
  hidden: boolean;
}

export interface DirectoryListing {
  path: string;
  parentPath: string | null;
  entries: FileEntry[];
  totalCount: number;
  hiddenCount: number;
}

export interface ListDirectoryRequest {
  path?: string | null;
  showHidden?: boolean;
}

export interface SettingsSnapshot {
  path: string;
  document: Record<string, unknown>;
}

export interface SaveSettingsRequest {
  document: Record<string, unknown>;
}

export type ShortcutSource = "default" | "user";

export interface ShortcutBinding {
  commandId: string;
  shortcut: string;
  source: ShortcutSource;
}

export interface ShortcutsSnapshot {
  path: string;
  bindings: ShortcutBinding[];
}

export interface SaveShortcutsRequest {
  bindings: ShortcutBinding[];
}

export interface ProviderHealth {
  ready: boolean;
  port: string | null;
  version: string | null;
  uptimeSeconds: number;
  connectedProviders: number;
  availableProviders: number;
  error: string | null;
}

export interface ProviderRemote {
  name: string;
  type: string;
  statusLabel: string;
  needsReconnect: boolean;
  error: string | null;
}

export interface ProviderWorkflowOption {
  name: string;
  label: string;
  help: string;
  defaultValue: string;
  required: boolean;
  password: boolean;
  choices: Array<{ value: string; help: string }>;
}

export interface ProviderWorkflow {
  type: string;
  name: string;
  description: string;
  options: ProviderWorkflowOption[];
}

export interface ProvidersSnapshot {
  health: ProviderHealth;
  remotes: ProviderRemote[];
  workflows: ProviderWorkflow[];
  loading: boolean;
  error: string | null;
}

export interface RemoteEditDraft {
  name: string;
  originalName: string;
  providerType: string;
  config: Record<string, string>;
  aboutJson: string | null;
  lastCheckedUnix: number | null;
}

export interface SaveRemoteRequest {
  originalName: string;
  name: string;
  parameters: Record<string, string>;
}

export interface RemoteTestResult {
  success: boolean;
  message: string;
  aboutJson: string | null;
  checkedUnix: number | null;
}

export interface RcloneConfigPaths {
  configPath: string | null;
  cachePath: string | null;
  tempPath: string | null;
  rawJson: string;
}

export type TransferType =
  | "upload"
  | "download"
  | "create"
  | "copy"
  | "move"
  | "rename"
  | "delete";

export type TransferStatus =
  | "queued"
  | "pending"
  | "in_progress"
  | "waiting_for_resolution"
  | "completed"
  | "failed"
  | "canceled"
  | "skipped"
  | "interrupted";

export interface TransferRecord {
  id: number;
  jobId: number;
  transferType: TransferType;
  itemType: "local" | "remote";
  status: TransferStatus;
  conflictPolicy: string;
  fileName: string;
  localSourcePath: string;
  localDestPath: string;
  remoteSourceName: string;
  remoteSourcePath: string;
  remoteDestName: string;
  remoteDestPath: string;
  totalBytes: number;
  transferredBytes: number;
  errorMessage: string;
  detailMessage: string;
  queuedAtMs: number;
  startedAtMs: number;
  completedAtMs: number;
  cancelable: boolean;
  retryable: boolean;
  undoable: boolean;
  undoTokenId: number;
}

export interface TransferFilter {
  search?: string;
  offset?: number;
  limit?: number;
}

export interface TransferPage {
  rows: TransferRecord[];
  totalCount: number;
  dbPath: string;
}
