import type { MistyFilePickerMode } from "@/features/picker/FilePicker";

export type MistyPickerSource = "files" | "library";

export interface MistyPickerProps {
  /** Omit to offer files only — the Library source needs a Space in context. */
  spaceId?: string;
  initialSource?: MistyPickerSource;
  fileMode?: MistyFilePickerMode;
  multiple?: boolean;
  title?: string;
  allowedExtensions?: string[];
  librarySelectedIds?: string[];
  libraryMaximum?: number;
  onCancel: () => void;
  onChooseFiles: (paths: string[]) => void;
  onChooseLibraryItems?: (itemIds: string[]) => void;
}
