import type { PowerToolEndpointKind } from "@/native/contracts/primitives";
// eslint-disable-next-line no-restricted-imports -- these transport types are owned by the shortcut registry
import type { ShortcutCommandDefinition, ShortcutPlatform } from "@/features/shortcuts/registry";
// eslint-disable-next-line no-restricted-imports -- shortcut slots are shared with native persistence
import type { ShortcutSlot } from "@/features/shortcuts/bindings";

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
