import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { hasTauriInternals } from "@/platform/tauri";
import { accountFetchMe } from "@/stores/account/useAccountStore";
import type { AccountMeResponse } from "@/models/interfaces/stores/account/useAccountStore";
import {
  isAccountSessionTransitioning,
  readAccountSessionGeneration,
} from "@/stores/account/useAuthTokenStore";
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

async function loadInstallerStatus(nativeOverride?: NativeSystemInfo) {
  const native = nativeOverride ?? (await invoke<NativeSystemInfo>("check_system"));
  const template = await invoke<MistyTemplateStatus>("misty_template_status");
  const [setupProbe] = await invoke<PathProbe[]>("probe_paths", {
    paths: [native.setup_path],
  });

  return buildInstallerStatusFromTemplate(native, template, setupProbe);
}

let setupStatusRequestSequence = 0;

function beginSetupStatusRequest() {
  return {
    sequence: ++setupStatusRequestSequence,
    accountGeneration: readAccountSessionGeneration(),
  };
}

function isCurrentSetupStatusRequest(request: {
  sequence: number;
  accountGeneration: number;
}): boolean {
  return (
    request.sequence === setupStatusRequestSequence &&
    request.accountGeneration === readAccountSessionGeneration()
  );
}

function installerStatusWithNativeIdentity(
  native: NativeSystemInfo,
  previous: InstallerStatus | null,
): InstallerStatus {
  return {
    os: native.os,
    arch: native.arch,
    misty_home: native.misty_home,
    install_dir: native.install_dir,
    legacy_install_dir: native.legacy_install_dir,
    db_path: native.db_path,
    installed_version: native.installed_version,
    current_user: native.current_user,
    current_license: native.current_license,
    ready: previous?.ready ?? false,
    folders: previous?.folders ?? [],
    binaries: previous?.binaries ?? [],
    setup_update:
      previous?.setup_update ??
      ({
        name: "Misty installer",
        path: native.setup_path,
        required: false,
        exists: false,
        status: "pending",
        message: "Installer checks could not be refreshed.",
      } satisfies InstallerStatus["setup_update"]),
  };
}

async function refreshLocalAccessToken() {
  return invoke<NativeSystemInfo>("ensure_local_access_token");
}

function licenseFromMe(me: AccountMeResponse): CurrentLicense {
  return {
    tier: me.tier,
    status: me.status,
    allows_use: me.allows_use,
    expires_at: me.expires_at,
    trial_started_at: me.trial_started_at,
    license_device: me.license_device || null,
  };
}

function mergeReleases(fetched: ReleaseVersion[], fallback: ReleaseVersion[]): ReleaseVersion[] {
  const seen = new Set<string>();
  const merged = [...fetched, ...fallback].flatMap((release) => {
    const version = release.version.trim();
    if (!version || seen.has(version)) return [];
    seen.add(version);
    return [
      {
        ...release,
        version,
        changes:
          release.changes.length > 0
            ? release.changes
            : ["Release files are available for this version."],
      },
    ];
  });

  return merged.length > 0 ? merged : fallback;
}

async function refreshVerifiedLicenseIfDue(native: NativeSystemInfo) {
  if (!native.current_user || !native.current_license?.needs_refresh) {
    return native;
  }
  try {
    const me = await accountFetchMe();
    if (me.id !== native.current_user.id) return native;
    return invoke<NativeSystemInfo>("save_verified_license", {
      license: licenseFromMe(me),
    });
  } catch (error) {
    void error;
    return native;
  }
}

export const useSetupStore = create<SetupStore>((set, get) => ({
  busy: false,
  events: [],
  installState: "idle",
  releases,
  releasesError: "",
  releasesLoading: false,
  selectedVersion: releases[0].version,
  status: null,
  systemError: "",
  selectedRelease: () =>
    get().releases.find((release) => release.version === get().selectedVersion) ??
    get().releases[0] ??
    releases[0],
  addEvent: (event) => set((state) => ({ events: [...state.events, event] })),
  loadReleases: async () => {
    if (!hasTauriInternals()) {
      set({
        releases,
        releasesError: "Release checks are only available in the Misty app.",
        releasesLoading: false,
      });
      return;
    }

    set({ releasesLoading: true, releasesError: "" });
    try {
      const fetched = await invoke<ReleaseVersion[]>("fetch_misty_releases");
      const available = mergeReleases(fetched, releases);
      const selectedVersion = available.some((release) => release.version === get().selectedVersion)
        ? get().selectedVersion
        : (available[0]?.version ?? releases[0].version);
      set({
        releases: available,
        releasesError: "",
        releasesLoading: false,
        selectedVersion,
      });
    } catch (error) {
      set({ releases, releasesError: String(error), releasesLoading: false });
    }
  },
  loadSystem: async () => {
    if (isAccountSessionTransitioning()) return;
    const request = beginSetupStatusRequest();
    try {
      if (!hasTauriInternals()) {
        if (!isCurrentSetupStatusRequest(request)) return;
        set({
          status: null,
          systemError: "Misty requires the native app runtime.",
        });
        return;
      }
      let native = await invoke<NativeSystemInfo>("check_system");
      if (native.current_user) {
        native = await refreshLocalAccessToken();
        native = await refreshVerifiedLicenseIfDue(native);
      }
      const status = await loadInstallerStatus(native);
      if (!isCurrentSetupStatusRequest(request)) return;
      set({ status, systemError: "" });
    } catch (error) {
      if (!isCurrentSetupStatusRequest(request)) return;
      set({ systemError: String(error) });
    }
  },
  refreshLocalAccessToken: async () => {
    if (isAccountSessionTransitioning()) return;
    const request = beginSetupStatusRequest();
    try {
      if (!hasTauriInternals()) return;
      const native = await refreshLocalAccessToken();
      const refreshedNative = native.current_user
        ? await refreshVerifiedLicenseIfDue(native)
        : native;
      const status = await loadInstallerStatus(refreshedNative);
      if (!isCurrentSetupStatusRequest(request)) return;
      set({ status, systemError: "" });
    } catch (error) {
      void error;
    }
  },
  saveAuthenticatedUser: async (user, license) => {
    let request = beginSetupStatusRequest();
    if (!hasTauriInternals()) {
      if (!isCurrentSetupStatusRequest(request)) return;
      set((state) => ({
        systemError: "Saving account state is only available in the Misty app.",
        events: [
          ...state.events,
          {
            level: "error",
            source: "installer",
            message: `Could not save account state for ${user.email}.`,
          },
        ],
      }));
      return;
    }
    const native = await invoke<NativeSystemInfo>("save_authenticated_user", {
      user,
      license: license ?? null,
    });
    // Supersede any installer refresh that started while the native identity
    // transaction was committing.
    request = beginSetupStatusRequest();
    try {
      const status = await loadInstallerStatus(native);
      if (!isCurrentSetupStatusRequest(request)) return;
      set((state) => ({
        status,
        systemError: "",
        events: [
          ...state.events,
          { level: "info", source: "installer", message: `Signed in as ${user.email}.` },
        ],
      }));
    } catch (error) {
      // The native identity has already been committed. A secondary installer
      // status refresh must not make callers roll back to a different token.
      if (!isCurrentSetupStatusRequest(request)) return;
      set((state) => ({
        status: installerStatusWithNativeIdentity(native, state.status),
        systemError: String(error),
        events: [
          ...state.events,
          { level: "info", source: "installer", message: `Signed in as ${user.email}.` },
        ],
      }));
    }
  },
  setSelectedVersion: (selectedVersion) => set({ selectedVersion }),
  launchMisty: async () => {
    try {
      if (!hasTauriInternals()) {
        throw new Error("Launching Misty is only available in the Misty app.");
      }
      const result = await invoke<string>("launch_misty");
      set((state) => ({
        events: [...state.events, { level: "info", source: "launcher", message: result }],
      }));
    } catch (error) {
      set((state) => ({
        events: [...state.events, { level: "error", source: "launcher", message: String(error) }],
      }));
    }
  },
  restartMisty: async () => {
    try {
      if (!hasTauriInternals()) {
        throw new Error("Restarting Misty is only available in the Misty app.");
      }
      const result = await invoke<string>("restart_misty");
      set((state) => ({
        events: [...state.events, { level: "info", source: "launcher", message: result }],
      }));
    } catch (error) {
      set((state) => ({
        events: [...state.events, { level: "error", source: "launcher", message: String(error) }],
      }));
    }
  },
  signOut: async () => {
    let request = beginSetupStatusRequest();
    if (!hasTauriInternals()) {
      if (!isCurrentSetupStatusRequest(request)) return;
      const error = new Error("Signing out is only available in the Misty app.");
      set((state) => ({
        systemError: error.message,
        events: [
          ...state.events,
          {
            level: "error",
            source: "installer",
            message: "Could not sign out outside the Misty app.",
          },
        ],
      }));
      throw error;
    }
    let native: NativeSystemInfo;
    try {
      native = await invoke<NativeSystemInfo>("sign_out_misty");
    } catch (error) {
      if (isCurrentSetupStatusRequest(request)) {
        set((state) => ({
          systemError: String(error),
          events: [
            ...state.events,
            { level: "error", source: "installer", message: String(error) },
          ],
        }));
      }
      throw error;
    }
    request = beginSetupStatusRequest();
    try {
      const status = await loadInstallerStatus(native);
      if (!isCurrentSetupStatusRequest(request)) return;
      set((state) => ({
        status,
        systemError: "",
        events: [
          ...state.events,
          { level: "info", source: "installer", message: "Signed out of Misty." },
        ],
      }));
    } catch (error) {
      if (!isCurrentSetupStatusRequest(request)) return;
      set((state) => ({
        status: installerStatusWithNativeIdentity(native, state.status),
        systemError: String(error),
        events: [
          ...state.events,
          { level: "info", source: "installer", message: "Signed out of Misty." },
        ],
      }));
    }
  },
  startInstall: async (userOverride) => {
    const { saveAuthenticatedUser, status, selectedRelease } = get();
    const release = selectedRelease();
    const installUser = status?.current_user ?? userOverride ?? null;

    if (!hasTauriInternals()) {
      set({
        installState: "error",
        events: [
          {
            level: "error",
            source: "installer",
            message: "Installing Misty is only available in the Misty app.",
          },
        ],
      });
      return;
    }

    if (!installUser) {
      set({
        installState: "error",
        events: [
          { level: "error", source: "installer", message: "Sign in to Misty before installing." },
        ],
      });
      return;
    }

    if (!status?.current_user) {
      await saveAuthenticatedUser(installUser);
    }

    set({
      busy: true,
      installState: "installing",
      events: [
        { level: "info", source: "installer", message: `Preparing Misty ${release.version}.` },
      ],
    });

    try {
      const result = await invoke<string>("install_misty_template", {
        version: release.version,
      });
      const status = await loadInstallerStatus();
      const restartAfterChecks = status.ready;
      set((state) => ({
        busy: false,
        installState: "success",
        status,
        events: [
          ...state.events,
          { level: "info", source: "installer", message: result },
          {
            level: restartAfterChecks ? "info" : "warn",
            source: "installer",
            message: restartAfterChecks
              ? "Restarting Misty."
              : "Misty was installed, but required checks are still incomplete. Restart skipped.",
          },
        ],
      }));
      if (!restartAfterChecks) {
        return;
      }
      try {
        await invoke<string>("restart_misty_app");
      } catch (restartError) {
        set((state) => ({
          events: [
            ...state.events,
            { level: "error", source: "installer", message: String(restartError) },
          ],
        }));
      }
    } catch (error) {
      set((state) => ({
        busy: false,
        installState: "error",
        events: [...state.events, { level: "error", source: "installer", message: String(error) }],
      }));
    }
  },
}));

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
