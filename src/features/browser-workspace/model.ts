/** Mirrors the native renderer projection. Credentials and vault keys have no
 * renderer-side representation. Native document state remains authoritative. */
export interface GroupFields {
  label: string;
  icon: string;
  order: number;
  hidden: boolean;
}
export interface WebsiteFields {
  group_id: string;
  title: string;
  url: string;
  order: number;
  pinned: boolean;
}
export interface WindowFields {
  title: string;
  order: number;
}
export type SplitTree =
  | { type: "leaf"; id: string }
  | {
      type: "split";
      id: string;
      direction: "horizontal" | "vertical";
      ratio: number;
      first: SplitTree;
      second: SplitTree;
    };
export interface LayoutFields {
  window_id: string;
  title: string;
  order: number;
  tree: SplitTree;
}
export interface TabFields {
  surface: "browser" | "files" | "agents" | "space";
  title: string;
  placement: { layout_id: string; pane_id: string; order: number };
  url: string | null;
  profile_id: string | null;
  website_id: string | null;
  tool_route: string | null;
  agent_owned: boolean;
}
export interface FieldsByKind {
  group: GroupFields;
  website: WebsiteFields;
  window: WindowFields;
  layout: LayoutFields;
  tab: TabFields;
}
export type RecordKind = keyof FieldsByKind;
export type SharedRecord<K extends RecordKind = RecordKind> = {
  [Kind in K]: { kind: Kind; id: string; fields: FieldsByKind[Kind] };
}[K];
export interface Resume {
  active_window_id: string;
  active_layout_id: string;
  focused_pane_id: string;
  active_tab_by_pane: Record<string, string>;
}
export interface WorkspaceView {
  version: 1;
  sequence: number;
  records: SharedRecord[];
  orphaned_tab_ids: string[];
  orphaned_website_ids: string[];
  resumes: Record<string, { sequence: number; resume: Resume }>;
  active_device?: { device_id: string | null; epoch: string; sequence: number } | null;
}
export type WorkspaceChange = {
  [K in RecordKind]:
    | { action: "create"; kind: K; id: string; fields: FieldsByKind[K] }
    | { action: "patch"; kind: K; id: string; fields: Partial<FieldsByKind[K]> }
    | { action: "delete"; kind: K; id: string };
}[RecordKind];
export type WorkspacePayload = { kind: "workspace"; version: 1; changes: WorkspaceChange[] };

/** Persisted only on this device. Receiving another device's resume record never
 * writes this object; Continue here explicitly selects one when requested. */
export interface DeviceSelection {
  activeWindowId?: string;
  activeLayoutByWindow: Record<string, string>;
  focusedPaneByLayout: Record<string, string>;
  activeTabByPane: Record<string, string>;
}
