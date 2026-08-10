import type { CompareMode, CompareTextDiffKind } from "../../types/workspace/ExplorerCompareDialog";

export interface CompareDialogSeed {
  paneId: string;
  leftPath: string;
  mode: CompareMode;
}

export interface CompareTextDiffRow {
  id: string;
  leftLine: number | null;
  rightLine: number | null;
  leftText: string;
  rightText: string;
  kind: CompareTextDiffKind;
}

export interface CompareTextDiffState {
  leftText: string;
  rightText: string;
  rows: CompareTextDiffRow[];
  truncated: boolean;
}

export interface CompareImagePreview {
  src: string;
  mimeType: string;
  byteLength: number;
}

export interface CompareImageState {
  left: CompareImagePreview;
  right: CompareImagePreview;
}
