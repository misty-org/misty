import type {
  PowerToolEndpointKind,
  ProviderConfigMode,
  ShortcutSource,
} from "@/native/contracts/primitives";

export interface NativeWorkspaceTabSnapshot {
  context_key: string;
  state_key: string;
  title: string;
  restore_state: string;
  idx: number;
}

export interface NativeWorkspacePaneSnapshot {
  pane_id: string;
  tabs: NativeWorkspaceTabSnapshot[];
  closed_tabs: NativeWorkspaceTabSnapshot[];
  active_tab_idx: number;
}

export interface NativeWorkspaceClosedPaneSnapshot extends NativeWorkspacePaneSnapshot {
  restore_mode: string;
  lane_index: number;
  row_index: number;
}

export interface NativeWorkspaceExplorerSnapshot {
  active_pane_id: string;
  next_tab_idx: number;
  next_pane_idx: number;
  grid_pane_ids: string[][];
  grid_split_ratio: number;
  lane_split_ratios: number[];
  panes: NativeWorkspacePaneSnapshot[];
  closed_panes: NativeWorkspaceClosedPaneSnapshot[];
}

export interface NativeWorkspaceFileTabSnapshot {
  idx: number;
  title: string;
  sidebar_visible: boolean;
  inspector_visible: boolean;
  explorer: NativeWorkspaceExplorerSnapshot;
}

export interface NativeWorkspace {
  id: string;
  title: string;
  sidebar_width: number;
  sidebar_visible: boolean;
  inspector_width: number;
  inspector_visible: boolean;
  active_tab_idx: number;
  next_tab_idx: number;
  tabs: NativeWorkspaceFileTabSnapshot[];
  explorer: NativeWorkspaceExplorerSnapshot;
}

export interface NativeWorkspaceDocument {
  schema_version: number;
  active_workspace_id: string;
  next_workspace_idx: number;
  workspaces: NativeWorkspace[];
}

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

export interface PluginCommandEntry {
  id: string;
  label: string;
  hint: string;
  pluginId: string;
  pluginName: string;
  defaultShortcut: string;
  source: string;
  actionKind: string;
  launcherOpenMode: string;
  requiresSelectedFile: boolean;
  pluginDir: string;
  manifestPath: string;
  libraryPath: string;
}

export interface PluginPanelEntry {
  id: string;
  title: string;
  pluginId: string;
  pluginName: string;
  windowType: string;
  defaultWidth: number;
  defaultHeight: number;
  pluginDir: string;
  manifestPath: string;
  libraryPath: string;
  webEntry: string;
  launcherViews: string[];
}

export interface ExtensionCommandRequest {
  pluginId: string;
  command: string;
  payload?: Record<string, unknown>;
}

export interface PluginCommandsSnapshot {
  roots: string[];
  commands: PluginCommandEntry[];
  panels: PluginPanelEntry[];
}

export interface RunPluginCommandRequest {
  commandId: string;
  selectedPaths?: string[];
}

export interface PluginCommandRunResult {
  commandId: string;
  pluginId: string;
  pluginName: string;
  label: string;
  handled: boolean;
  targetRoute: string;
  message: string;
  notifications: PluginPanelNotification[];
  runtimeStatus: string;
}

export interface RenderPluginPanelRequest {
  panelId: string;
  pluginId?: string;
  selectedPaths?: string[];
  clickedButton?: string;
  inputs?: Record<string, string>;
}

export interface PluginPanelRenderResult {
  panelId: string;
  pluginId: string;
  pluginName: string;
  title: string;
  elements: PluginPanelElement[];
  notifications: PluginPanelNotification[];
  message: string;
  runtimeStatus: string;
}

export interface PluginPanelElement {
  kind: string;
  id: string;
  text: string;
  width: number;
  height: number;
  border: boolean;
}

export interface PluginPanelNotification {
  level: string;
  title: string;
  message: string;
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
  configSource: string;
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

export interface CloudConfigPaths {
  configPath: string | null;
  cachePath: string | null;
  tempPath: string | null;
  rawJson: string;
}

export interface PowerToolEndpoint {
  kind: PowerToolEndpointKind;
  remote?: string;
  path: string;
}

export interface TransferProfileOptions {
  transfers?: number;
  checkers?: number;
  bandwidthLimit?: string;
  retries?: number;
  lowLevelRetries?: number;
  checksum?: boolean;
}

export interface VerifyOptions {
  oneWay?: boolean;
  download?: boolean;
  profile?: TransferProfileOptions;
}

export interface VerifyStartRequest {
  source: PowerToolEndpoint;
  dest: PowerToolEndpoint;
  options?: VerifyOptions;
}

export interface ProviderJobStart {
  jobId: string;
}

export interface ProviderJobStatus {
  jobId: string;
  operation: string;
  state: string;
  phase: string;
  bytesCompleted: number;
  bytesTotal: number;
  bytesPerSecond?: number;
  sourceRemote?: string | null;
  sourcePath?: string | null;
  destRemote?: string | null;
  destPath?: string | null;
  message?: string | null;
  resultReady?: boolean;
  resultKind?: string | null;
}

export interface VerifyResult {
  success: boolean;
  status?: string | null;
  hashType?: string | null;
  missingOnSrc: string[];
  missingOnDst: string[];
  match: string[];
  differ: string[];
  error: string[];
  combined: string[];
}

export interface ProviderConfigRequest {
  name: string;
  providerType: string;
  parameters: Record<string, string>;
  state?: string;
  result?: string;
  mode: ProviderConfigMode;
  continuing?: boolean;
  continueExisting?: boolean;
}
