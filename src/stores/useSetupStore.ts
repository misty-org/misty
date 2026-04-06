import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { hasTauriInternals } from "@/shared/tauri";
import { accountFetchMe, type AccountMeResponse } from "../pages/Account/shared/api";
import { buildInstallerStatusFromTemplate } from "../data/installReadiness";
import { releases } from "../data/releases";
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
} from "../models/setup";

type SetupStore = {
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

async function loadInstallerStatus(nativeOverride?: NativeSystemInfo) {
  const native = nativeOverride ?? (await invoke<NativeSystemInfo>("check_system"));
  const template = await invoke<MistyTemplateStatus>("misty_template_status");
  const [setupProbe] = await invoke<PathProbe[]>("probe_paths", {
    paths: [native.setup_path],
  });

  return buildInstallerStatusFromTemplate(native, template, setupProbe);
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
    try {
      if (!hasTauriInternals()) {
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
      set({ status, systemError: "" });
    } catch (error) {
      set({ systemError: String(error) });
    }
  },
  refreshLocalAccessToken: async () => {
    try {
      if (!hasTauriInternals()) return;
      const native = await refreshLocalAccessToken();
      if (!native.current_user) {
        return;
      }
      const refreshedNative = await refreshVerifiedLicenseIfDue(native);
      const status = await loadInstallerStatus(refreshedNative);
      set({ status, systemError: "" });
    } catch (error) {
      void error;
    }
  },
  saveAuthenticatedUser: async (user, license) => {
    if (!hasTauriInternals()) {
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
    const status = await loadInstallerStatus(native);
    set((state) => ({
      status,
      systemError: "",
      events: [
        ...state.events,
        { level: "info", source: "installer", message: `Signed in as ${user.email}.` },
      ],
    }));
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
    try {
      if (!hasTauriInternals()) {
        set((state) => ({
          systemError: "Signing out is only available in the Misty app.",
          events: [
            ...state.events,
            {
              level: "error",
              source: "installer",
              message: "Could not sign out outside the Misty app.",
            },
          ],
        }));
        return;
      }
      const native = await invoke<NativeSystemInfo>("sign_out_misty");
      const status = await loadInstallerStatus(native);
      set((state) => ({
        status,
        events: [
          ...state.events,
          { level: "info", source: "installer", message: "Signed out of Misty." },
        ],
      }));
    } catch (error) {
      set((state) => ({
        events: [...state.events, { level: "error", source: "installer", message: String(error) }],
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
