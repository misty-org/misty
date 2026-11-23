import type { ComponentType } from "react";
import { createPort } from "@/shared/lib/seams";

export interface PickedDriveFile {
  id: string;
  space_id: string;
  path: string;
  name: string;
  size: number;
}

export interface DrivePickerProps {
  spaceId: string;
  active?: boolean;
  maximumSelected?: number;
  onCancel: () => void;
  onChoose: (files: PickedDriveFile[]) => void;
}

export const drivePicker = createPort<ComponentType<DrivePickerProps>>("the Space drive picker");

export function DrivePickerPanel(props: DrivePickerProps) {
  const Picker = drivePicker.maybe();
  return Picker ? <Picker {...props} /> : null;
}
