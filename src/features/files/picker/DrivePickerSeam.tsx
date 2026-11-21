import type { ComponentType } from "react";
import { createPort } from "@/shared/lib/seams";

/** A file chosen from a Space's drive: its stable id and its path there, from the drive's root. */
export interface PickedDriveFile {
  id: string;
  space_id: string;
  path: string;
  name: string;
  size: number;
}

export interface DrivePickerProps {
  spaceId: string;
  /** Whether this panel is the one showing in the shared picker. */
  active?: boolean;
  maximumSelected?: number;
  onCancel: () => void;
  onChoose: (files: PickedDriveFile[]) => void;
}

/** The Space drive picker belongs to Spaces, which sits above files and fills this in at startup. */
export const drivePicker = createPort<ComponentType<DrivePickerProps>>("the Space drive picker");

export function DrivePickerPanel(props: DrivePickerProps) {
  const Picker = drivePicker.maybe();
  return Picker ? <Picker {...props} /> : null;
}
