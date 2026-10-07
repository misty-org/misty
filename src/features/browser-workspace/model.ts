/** Mirrors the native renderer projection. Credentials and vault keys have no
 * renderer-side representation. Native document state remains authoritative.
 * Names follow the sync hierarchy: window → tab → pane → view, plus bookmark
 * folders and bookmarks. Native storage keeps older names and translates them
 * at the renderer boundary. */
export interface FolderFields {
  label: string;
  icon: string;
  order: number;
  hidden: boolean;
}
export interface BookmarkFields {
  folder_id: string;
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
  | {
      type: "leaf";
      id: string;
    }
  | {
      type: "split";
      id: string;
      direction: "horizontal" | "vertical";
      ratio: number;
      first: SplitTree;
      second: SplitTree;
    };
export interface TabFields {
  window_id: string;
  title: string;
  order: number;
  tree: SplitTree;
}
export interface ViewFields {
  /** "home" is the retired Home page, still sent by older clients. */
  surface: "browser" | "files" | "agents" | "space" | "home" | "extensions";
  title: string;
  placement: {
    tab_id: string;
    pane_id: string;
    order: number;
  };
  url: string | null;
  profile_id: string | null;
  bookmark_id: string | null;
  tool_route: string | null;
  agent_owned: boolean;
}
export interface TabGroupFields {
  name: string;
  color: string;
  order: number;
  tab_ids: string[];
}
export interface SavedTabGroupFields {
  name: string;
  color: string;
  order: number;
  /** The saved tabs, as JSON text. */
  tabs: string;
}
export interface FieldsByKind {
  folder: FolderFields;
  bookmark: BookmarkFields;
  window: WindowFields;
  tab: TabFields;
  view: ViewFields;
  tab_group: TabGroupFields;
  saved_tab_group: SavedTabGroupFields;
}
export type RecordKind = keyof FieldsByKind;
export type SharedRecord<K extends RecordKind = RecordKind> = {
  [Kind in K]: {
    kind: Kind;
    id: string;
    fields: FieldsByKind[Kind];
  };
}[K];
export interface Resume {
  active_window_id: string;
  active_tab_id: string;
  focused_pane_id: string;
  active_view_by_pane: Record<string, string>;
}
export interface WorkspaceRecords {
  version: 1;
  sequence: number;
  records: SharedRecord[];
  orphaned_view_ids: string[];
  orphaned_bookmark_ids: string[];
  resumes: Record<
    string,
    {
      sequence: number;
      resume: Resume;
    }
  >;
  active_device?: {
    device_id: string | null;
    epoch: string;
    sequence: number;
  } | null;
}
export type WorkspaceChange = {
  [K in RecordKind]:
    | {
        action: "create";
        kind: K;
        id: string;
        fields: FieldsByKind[K];
      }
    | {
        action: "patch";
        kind: K;
        id: string;
        fields: Partial<FieldsByKind[K]>;
      }
    | {
        action: "delete";
        kind: K;
        id: string;
      };
}[RecordKind];

/** Persisted only on this device. Receiving another device's resume record never
 * writes this object; Continue here explicitly selects one when requested. */
export interface DeviceSelection {
  activeWindowId?: string;
  activeTabByWindow: Record<string, string>;
  focusedPaneByTab: Record<string, string>;
  activeViewByPane: Record<string, string>;
  /** The window's tab order as last shown, so a selection closed on
   * another machine moves to its neighbor rather than the first tab. */
  tabOrderByWindow?: Record<string, string[]>;
}
