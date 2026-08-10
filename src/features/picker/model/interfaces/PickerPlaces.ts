import type { MountedDevice, ProviderRemote } from "@/native/contracts";

export interface PickerPlacesProps {
  homePath: string;
  activePath: string;
  mountRoot: string;
  remotes: ProviderRemote[];
  remoteLoading: boolean;
  devices: MountedDevice[];
  devicesLoading: boolean;
  pinnedPaths: string[];
  onNavigate: (path: string) => void;
}
