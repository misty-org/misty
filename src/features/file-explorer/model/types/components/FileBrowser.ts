import type { ExplorerSortColumn } from "../../../store";

export type FileTableColumn = ExplorerSortColumn;

export type FileTableColumnWidths = Record<FileTableColumn, number>;

export type GridThumbnailSubscriber = (url: string | null) => void;
