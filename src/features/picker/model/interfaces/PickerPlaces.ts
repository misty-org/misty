import type { MountedDevice } from "@/native/contracts";

export interface PickerPlacesProps {
  homePath: string;
  activePath: string;
  mountRoot: string;
  devices: MountedDevice[];
  devicesLoading: boolean;
  pinnedPaths: string[];
  onNavigate: (path: string) => void;
}
