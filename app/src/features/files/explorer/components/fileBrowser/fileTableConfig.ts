import type {
  FileTableColumn,
  FileTableColumnWidths,
} from "../../model/types/components/FileBrowser";

export const TABLE_OVERSCAN_ROWS = 4;
export const GRID_ITEM_HEIGHT = 156;
export const GRID_GAP = 18;
export const GRID_PADDING = 3;
export const GRID_SCROLLBAR_RESERVE = 14;
export const GRID_OVERSCAN_ROWS = 2;
export const GRID_THUMBNAIL_MAX_DIMENSION = 384;
export const MAX_CONCURRENT_GRID_THUMBNAILS = 3;
export const DEFAULT_ITEM_SCALE = 1;

export const fileTableColumns: FileTableColumn[] = ["name", "modified", "size", "type"];

export const fileTableColumnLabels: Record<FileTableColumn, string> = {
  name: "Name",
  modified: "Modified",
  size: "Size",
  type: "Type",
};

export const defaultColumnWidths: FileTableColumnWidths = {
  name: 220,
  modified: 220,
  size: 128,
  type: 128,
};

export const minimumColumnWidths: FileTableColumnWidths = {
  name: 180,
  modified: 150,
  size: 92,
  type: 120,
};

export const maximumColumnWidths: FileTableColumnWidths = {
  name: 640,
  modified: 360,
  size: 220,
  type: 260,
};

export function normalizeItemScale(scale: number | undefined): number {
  if (!Number.isFinite(scale)) return DEFAULT_ITEM_SCALE;
  return Math.min(2, Math.max(0, Math.round(scale ?? DEFAULT_ITEM_SCALE)));
}
