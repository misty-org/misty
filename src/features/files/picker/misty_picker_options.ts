import type { MistyFilePickerMode } from "./FilePicker";
import type { PickedDriveFile } from "./DrivePickerSeam";

export type MistyPickerSource = "files" | "space";

export interface MistyPickerProps {
  spaceId?: string;
  initialSource?: MistyPickerSource;
  fileMode?: MistyFilePickerMode;
  multiple?: boolean;
  title?: string;
  allowedExtensions?: string[];
  driveMaximum?: number;
  onCancel: () => void;
  onChooseFiles: (paths: string[]) => void;
  onChooseDriveFiles?: (files: PickedDriveFile[]) => void;
}
