/** A profile's records as the renderer sees them, shared by all its windows. The native side
 * keeps older stored names and translates them at the renderer boundary. */
interface FolderFields {
  label: string;
  icon: string;
  order: number;
  hidden: boolean;
  /** Absent for the roots and for folders directly in Other bookmarks. */
  parent_id?: string;
  /** First added, in ms since the epoch (kept from imports). */
  added_at?: number;
}
interface BookmarkFields {
  folder_id: string;
  title: string;
  url: string;
  order: number;
  pinned: boolean;
  /** First added, in ms since the epoch (kept from imports). */
  added_at?: number;
}
interface SavedTabGroupFields {
  name: string;
  color: string;
  order: number;
  /** The saved tabs, as JSON text. */
  tabs: string;
}
interface FieldsByKind {
  folder: FolderFields;
  bookmark: BookmarkFields;
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

const rendererKinds: Record<string, RecordKind> = {
  folder: "folder",
  group: "folder",
  bookmark: "bookmark",
  website: "bookmark",
  saved_tab_group: "saved_tab_group",
};
const rendererFields: Record<RecordKind, Record<string, string>> = {
  folder: {},
  bookmark: { group_id: "folder_id" },
  saved_tab_group: { layouts: "tabs" },
};

/**
 * A record as this renderer names it, whichever names it was saved under: older saved windows
 * and stored records say `group`, `website`, `group_id` and `layouts`. `null` for a kind this
 * renderer doesn't show, which it must leave alone.
 */
function rendererRecord(record: {
  kind: string;
  id: string;
  fields: object;
}): SharedRecord | null {
  const kind = rendererKinds[record.kind];
  if (!kind) return null;
  const renames = rendererFields[kind];
  const fields = Object.fromEntries(
    Object.entries(record.fields).map(([name, value]) => [renames[name] ?? name, value]),
  );
  return { ...record, kind, fields } as SharedRecord;
}

export function rendererRecords(records: { kind: string; id: string; fields: object }[]) {
  return records.flatMap((record) => rendererRecord(record) ?? []);
}
