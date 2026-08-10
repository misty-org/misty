import type {
  CurrentLicense,
  CurrentUser,
  InstallerStatus,
  InstallEvent,
  InstallState,
  ReleaseVersion,
} from "@/features/installer";

export type SetupStore = {
  busy: boolean;
  events: InstallEvent[];
  installState: InstallState;
  releases: ReleaseVersion[];
  releasesError: string;
  releasesLoading: boolean;
  selectedVersion: string;
  status: InstallerStatus | null;
  systemError: string;
  selectedRelease: () => ReleaseVersion;
  addEvent: (event: InstallEvent) => void;
  loadReleases: () => Promise<void>;
  loadSystem: () => Promise<void>;
  refreshLocalAccessToken: () => Promise<void>;
  restartMisty: () => Promise<void>;
  saveAuthenticatedUser: (user: CurrentUser, license?: CurrentLicense | null) => Promise<void>;
  setSelectedVersion: (version: string) => void;
  launchMisty: () => Promise<void>;
  signOut: () => Promise<void>;
  startInstall: (userOverride?: CurrentUser | null) => Promise<void>;
};
