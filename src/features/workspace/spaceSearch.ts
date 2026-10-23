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
} from "./browserSearchEngine";

/**
 * Search engines and bangs are Space data: they live in the sync vault of the
 * window's Space and follow it to every device in that Space. While no Space
 * vault is open (sync off or locked) the device's own shortcuts apply, as
 * before. Suggestions stay a device setting.
 */
export interface SpaceSearch {
  spaceId: string | null;
  engine: string;
  engines: { id: string; name: string; search: string }[];
  bangs: BrowserCustomBang[];
}

interface SpaceSearchState {
  /** The window's Space's search settings; null while no Space vault is open. */
  space: SpaceSearch | null;
  /** This device's own shortcuts, as the settings document keeps them. */
  deviceBangsRaw: string;
}

export const useSpaceSearchStore = create<SpaceSearchState>(() => ({
  space: null,
  deviceBangsRaw: "[]",
}));

function apply(): void {
  const { space, deviceBangsRaw } = useSpaceSearchStore.getState();
  if (space) {
    configureBrowserSearchEngine(space.engine);
    setBrowserCustomBangs(space.bangs);
  } else {
    configureBrowserSearchEngine(browserSearchEngines[0].id);
    configureBrowserCustomBangs(deviceBangsRaw);
  }
}

/** Reads the window's Space's search settings; a failed read keeps the current ones. */
export async function refreshSpaceSearch(): Promise<void> {
  try {
    const space = await invoke<SpaceSearch | null>("browser_space_search");
    useSpaceSearchStore.setState({
      space: space ? { ...space, bangs: sanitizeBrowserCustomBangs(space.bangs) } : null,
    });
  } catch {
    /* Sync is unavailable right now; keep what applies. */
  }
  apply();
}

let started = false;

/** The device's own shortcuts changed (settings load or edit while sync is off). */
export function configureDeviceBangs(raw: string): void {
  useSpaceSearchStore.setState({ deviceBangsRaw: raw });
  apply();
  if (started) return;
  started = true;
  void refreshSpaceSearch();
  // Another device edited the Space, or a vault opened or locked.
  for (const event of ["misty:space-search-changed", "misty:browser-sync-changed"]) {
    void listen(event, () => void refreshSpaceSearch()).catch(() => undefined);
  }
}
