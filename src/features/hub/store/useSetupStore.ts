import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { fetchMe, type MeResponse } from "../website/pages/Dashboard/api";
import {
  buildInstallerStatus,
  executableNameForOs,
  mistyPath,
  requiredMistyBinaries,
  requiredMistyFolders,
} from "../data/installReadiness";
import { releases } from "../data/releases";
import type {
  CurrentLicense,
  CurrentUser,
  InstallEvent,
  InstallerStatus,
  InstallState,
  NativeSystemInfo,
  PathProbe,
  ReleaseVersion,
} from "../types/setup";

type SetupStore = {
  busy: boolean;
  events: InstallEvent[];
  installState: InstallState;
  selectedVersion: string;
  status: InstallerStatus | null;
  systemError: string;
  selectedRelease: () => ReleaseVersion;
  addEvent: (event: InstallEvent) => void;
  loadSystem: () => Promise<void>;
  refreshLocalAccessToken: () => Promise<void>;
  restartMisty: () => Promise<void>;
  saveAuthenticatedUser: (user: CurrentUser, license?: CurrentLicense | null) => Promise<void>;
  setSelectedVersion: (version: string) => void;
  launchMisty: () => Promise<void>;
  signOut: () => Promise<void>;
  startInstall: (userOverride?: CurrentUser | null) => Promise<void>;
};

function browserSystemFallback(): InstallerStatus {
  const platform = navigator.platform || "desktop";
  const os = platform.toLowerCase().includes("mac")
    ? "macos"
    : platform.toLowerCase().includes("win")
      ? "windows"
      : platform.toLowerCase().includes("linux")
        ? "linux"
        : "desktop";

  return {
    os,
    arch: platform.toLowerCase().includes("arm") ? "arm64" : "x86_64",
    misty_home: "~/.misty",
    install_dir: "~/.misty/.local/bin",
    legacy_install_dir: "~/.misty/local/bin",
    db_path: "~/.misty/db/data.db",
    current_user: null,
    current_license: null,
    ready: false,
    folders: requiredMistyFolders.map((folder) => ({
      name: folder,
      path: `~/.misty/${folder}`,
      required: true,
      exists: false,
      status: "missing",
      message: "Folder readiness is only verified in the desktop app.",
    })),
    binaries: [
      {
        name: executableNameForOs(os, "misty"),
        path: `~/.misty/.local/bin/${executableNameForOs(os, "misty")}`,
        required: true,
        exists: false,
        status: "missing",
        message: "Binary will be installed from a release archive.",
      },
    ],
    setup_update: {
      name: "Misty Hub",
      path: "browser preview",
      required: false,
      exists: true,
      status: "pending",
      message: "Hub update check is only available in the desktop app.",
    },
  };
}

async function loadInstallerStatus(nativeOverride?: NativeSystemInfo) {
  const native = nativeOverride ?? (await invoke<NativeSystemInfo>("check_system"));
  const folderProbes = await invoke<PathProbe[]>("ensure_misty_folders", {
    folders: requiredMistyFolders,
  });
  const binaryProbes = await invoke<PathProbe[]>("probe_paths", {
    paths: requiredMistyBinaries.map((binary) =>
      mistyPath(native.install_dir, executableNameForOs(native.os, binary)),
    ),
  });
  const [setupProbe] = await invoke<PathProbe[]>("probe_paths", {
    paths: [native.setup_path],
  });

  return buildInstallerStatus(native, folderProbes, binaryProbes, setupProbe);
}

async function refreshLocalAccessToken() {
  return invoke<NativeSystemInfo>("ensure_local_access_token");
}

function licenseFromMe(me: MeResponse): CurrentLicense {
  return {
    tier: me.tier,
    status: me.status,
    allows_use: me.allows_use,
    expires_at: me.expires_at,
    trial_started_at: me.trial_started_at,
    license_device: me.license_device || null,
  };
}

async function refreshVerifiedLicenseIfDue(native: NativeSystemInfo) {
  if (!native.current_user || !native.current_license?.needs_refresh) {
    return native;
  }
  try {
    const me = await fetchMe();
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
  selectedVersion: releases[0].version,
  status: null,
  systemError: "",
  selectedRelease: () =>
    releases.find((release) => release.version === get().selectedVersion) ?? releases[0],
  addEvent: (event) => set((state) => ({ events: [...state.events, event] })),
  loadSystem: async () => {
    try {
      let native = await invoke<NativeSystemInfo>("check_system");
      if (native.current_user) {
        native = await refreshLocalAccessToken();
        native = await refreshVerifiedLicenseIfDue(native);
      }
      const status = await loadInstallerStatus(native);
      set({ status, systemError: "" });
    } catch (error) {
      if (String(error).toLowerCase().includes("invoke")) {
        set({ status: browserSystemFallback(), systemError: "" });
        return;
      }

      set({ systemError: String(error) });
    }
  },
  refreshLocalAccessToken: async () => {
    try {
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
    const native = await invoke<NativeSystemInfo>("save_authenticated_user", {
      user,
      license: license ?? null,
    });
    const status = await loadInstallerStatus(native);
    set((state) => ({
      status,
      systemError: "",
      events: [...state.events, { level: "info", source: "installer", message: `Signed in as ${user.email}.` }],
    }));
  },
  setSelectedVersion: (selectedVersion) => set({ selectedVersion }),
  launchMisty: async () => {
    try {
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
      const native = await invoke<NativeSystemInfo>("sign_out_misty");
      const status = await loadInstallerStatus(native);
      set((state) => ({
        status,
        events: [...state.events, { level: "info", source: "installer", message: "Signed out of Misty." }],
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

    if (!installUser) {
      set({
        installState: "error",
        events: [{ level: "error", source: "installer", message: "Sign in to Misty before installing." }],
      });
      return;
    }

    if (!status?.current_user) {
      await saveAuthenticatedUser(installUser);
    }

    set({
      busy: true,
      installState: "installing",
      events: [{ level: "info", source: "installer", message: `Preparing Misty ${release.version}.` }],
    });

    try {
      const result = await invoke<string>("install_misty", {
        manifestUrl: release.manifestUrl,
        version: release.version,
      });
      const status = await loadInstallerStatus();
      set((state) => ({
        busy: false,
        installState: "success",
        status,
        events: [...state.events, { level: "info", source: "installer", message: result }],
      }));
    } catch (error) {
      set((state) => ({
        busy: false,
        installState: "error",
        events: [...state.events, { level: "error", source: "installer", message: String(error) }],
      }));
    }
  },
}));
