import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { hasTauriInternals } from "@/platform/tauri";
import { accountFetchMe } from "@/stores/account/useAccountStore";
import type { AccountMeResponse } from "@/models/interfaces/stores/account/useAccountStore";
import { buildInstallerStatusFromTemplate } from "@/features/installer/data/installReadiness";
import { releases } from "@/features/installer/data/releases";
import type {
  CurrentLicense,
  CurrentUser,
  InstallEvent,
  InstallerStatus,
  InstallState,
  MistyTemplateStatus,
  NativeSystemInfo,
  PathProbe,
  ReleaseVersion,
} from "@/models/types/features/installer/types";

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
