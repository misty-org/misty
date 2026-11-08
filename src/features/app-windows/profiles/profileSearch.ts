import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import {
  browserSearchEngines,
  configureBrowserCustomBangs,
  configureBrowserSearchEngine,
  sanitizeBrowserCustomBangs,
  setBrowserCustomBangs,
  type BrowserCustomBang,
} from "../addresses/browserSearchEngine";

/**
 * Search engines and bangs belong to the window's profile. While its records can't be read this
 * computer's own shortcuts apply. Suggestions stay a setting of this computer.
 */
interface ProfileSearch {
  profile: string | null;
  engine: string;
  engines: { id: string; name: string; search: string }[];
  bangs: BrowserCustomBang[];
}

interface ProfileSearchState {
  /** The window's profile's search settings; null while they can't be read. */
  profile: ProfileSearch | null;
  /** This computer's own shortcuts, as the settings document keeps them. */
  deviceBangsRaw: string;
}

export const useProfileSearchStore = create<ProfileSearchState>(() => ({
  profile: null,
  deviceBangsRaw: "[]",
}));

function apply(): void {
  const { profile, deviceBangsRaw } = useProfileSearchStore.getState();
  if (profile) {
    configureBrowserSearchEngine(profile.engine);
    setBrowserCustomBangs(profile.bangs);
  } else {
    configureBrowserSearchEngine(browserSearchEngines[0].id);
    configureBrowserCustomBangs(deviceBangsRaw);
  }
}

/** Reads the window's profile's search settings; a failed read keeps the current ones. */
export async function refreshProfileSearch(): Promise<void> {
  try {
    const profile = await invoke<ProfileSearch | null>("browser_profile_search");
    useProfileSearchStore.setState({
      profile: profile ? { ...profile, bangs: sanitizeBrowserCustomBangs(profile.bangs) } : null,
    });
  } catch {
    /* Unavailable right now; keep what applies. */
  }
  apply();
}

let started = false;

/** This computer's own shortcuts changed (settings load or edit). */
export function configureDeviceBangs(raw: string): void {
  useProfileSearchStore.setState({ deviceBangsRaw: raw });
  apply();
  if (started) return;
  started = true;
  void refreshProfileSearch();
  // The profile's search settings changed, here or in another signed-in session.
  void listen<{ collection?: string }>("misty://profile-records-changed", ({ payload }) => {
    if (payload.collection === "search") void refreshProfileSearch();
  }).catch(() => undefined);
}
