import type { ExplorerSortColumn } from "../../../store/index";

export type FileTableColumn = ExplorerSortColumn;

export type FileTableColumnWidths = Record<FileTableColumn, number>;

export type GridThumbnailSubscriber = (url: string | null) => void;
