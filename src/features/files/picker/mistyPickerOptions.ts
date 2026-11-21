import type { MistyFilePickerMode } from "./FilePicker";
import type { PickedDriveFile } from "./DrivePickerSeam";

/** Where the person picks from: this computer, or the Space's Files (its drive). */
export type MistyPickerSource = "files" | "space";

export interface MistyPickerProps {
  /** Omit to offer files only — the Space's Files need a Space in context. */
  spaceId?: string;
  initialSource?: MistyPickerSource;
  fileMode?: MistyFilePickerMode;
  multiple?: boolean;
  title?: string;
  allowedExtensions?: string[];
  /** The most Space files that may be chosen at once. */
  driveMaximum?: number;
  onCancel: () => void;
  onChooseFiles: (paths: string[]) => void;
  onChooseDriveFiles?: (files: PickedDriveFile[]) => void;
}
