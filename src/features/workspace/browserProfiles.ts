import { allLayoutViews } from "./layoutTabs";
import type { WorkspaceLayout, WorkspaceScopeKey } from "./model";
import type { WorkspaceStore } from "./useWorkspaceStore";
import { switchWorkspaceScope } from "./windows";
import { windowSpaceScope } from "./spaceWindow";

/**
 * A browser profile on this device: its own virtual windows and its own
 * website data, so sign-ins stay apart. The default profile is the account's
 * synced workspace and is not listed here. Other profiles stay on this device.
 */
export interface BrowserProfile {
  id: string;
  name: string;
  /** The native website-data identity (64 hex characters). */
  dataId: string;
  createdAt: number;
  /** Sites (hosts, subdomains included) whose links from other apps open here. */
  sites?: string[];
}

interface BrowserProfileState {
  browserProfiles: BrowserProfile[];
}

interface BrowserProfileActions {
  createBrowserProfile(name: string): BrowserProfile;
  renameBrowserProfile(id: string, name: string): void;
  setBrowserProfileSites(id: string, sites: string[]): void;
  /** Removes the profile and its windows. Returns its data identity so the caller can erase it. */
  removeBrowserProfile(id: string): string | null;
  /** `null` returns to the default profile. */
  selectBrowserProfile(id: string | null): boolean;
}

const initialBrowserProfiles = (): BrowserProfileState => ({ browserProfiles: [] });

export interface BrowserProfileStore extends BrowserProfileState, BrowserProfileActions {}

/**
 * The scope `setScope` switches to. The window's own Space scope means the workspace
 * on screen, so a device profile keeps its own tabs; switching profiles goes through
 * selectBrowserProfile.
 */
export function scopeTarget(active: WorkspaceScopeKey, requested: WorkspaceScopeKey) {
  return requested === windowSpaceScope() && profileIdFromScope(active) ? active : requested;
}

function profileScopeKey(id: string): WorkspaceScopeKey {
  return `profile:${id}`;
}

export function profileIdFromScope(scope: string): string | null {
  return scope.startsWith("profile:") ? scope.slice("profile:".length) : null;
}

/** Hosts as typed (example.com, https://mail.example.com/…), lowercased and deduplicated. */
function normalizeSites(sites: string[]): string[] {
  const hosts = sites.flatMap((site) => {
    const value = site.trim().toLowerCase();
    if (!value) return [];
    try {
      const host = new URL(value.includes("://") ? value : `https://${value}`).hostname;
      return host ? [host.replace(/^www\./, "")] : [];
    } catch {
      return [];
    }
  });
  return [...new Set(hosts)].slice(0, 200);
}

/** The device profile that claims a site's links, if any. */
export function profileForSite(
  profiles: readonly BrowserProfile[],
  url: string,
): BrowserProfile | undefined {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
  return profiles.find((profile) =>
    profile.sites?.some((site) => host === site || host.endsWith(`.${site}`)),
  );
}

function newDataId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function profileName(value: string): string {
  const name = value.trim().slice(0, 60);
  return name || "Profile";
}

/** The website-data identity for a view, from the profile whose layout holds it. */
export function profileDataIdForView(
  state: Pick<WorkspaceStore, "browserProfiles" | "layoutsByScope" | "layout" | "activeScopeKey">,
  viewId: string,
): string | undefined {
  const layouts: Partial<Record<string, WorkspaceLayout>> = {
    ...state.layoutsByScope,
    [state.activeScopeKey]: state.layout,
  };
  for (const [scope, layout] of Object.entries(layouts)) {
    const id = profileIdFromScope(scope);
    if (!id || !layout) continue;
    const holds = allLayoutViews(layout).some((view) => view.id === viewId);
    if (holds) return state.browserProfiles.find((profile) => profile.id === id)?.dataId;
  }
  return undefined;
}

/** Initial profile state with the profile actions, for the workspace store. */
export function browserProfileSlice(
  set: (patch: Partial<WorkspaceStore>) => void,
  get: () => WorkspaceStore,
): BrowserProfileStore {
  return { ...initialBrowserProfiles(), ...browserProfileActions(set, get) };
}

function browserProfileActions(
  set: (patch: Partial<WorkspaceStore>) => void,
  get: () => WorkspaceStore,
): BrowserProfileActions {
  return {
    createBrowserProfile(name) {
      const profile: BrowserProfile = {
        id: crypto.randomUUID(),
        name: profileName(name),
        dataId: newDataId(),
        createdAt: Date.now(),
      };
      set({ browserProfiles: [...get().browserProfiles, profile] });
      return profile;
    },
    setBrowserProfileSites(id, sites) {
      set({
        browserProfiles: get().browserProfiles.map((profile) =>
          profile.id === id ? { ...profile, sites: normalizeSites(sites) } : profile,
        ),
      });
    },
    renameBrowserProfile(id, name) {
      set({
        browserProfiles: get().browserProfiles.map((profile) =>
          profile.id === id ? { ...profile, name: profileName(name) } : profile,
        ),
      });
    },
    removeBrowserProfile(id) {
      const profile = get().browserProfiles.find((item) => item.id === id);
      if (!profile) return null;
      if (profileIdFromScope(get().activeScopeKey) === id) get().selectBrowserProfile(null);
      const scope = profileScopeKey(id);
      const state = get();
      const without = <T>(record: Partial<Record<WorkspaceScopeKey, T>>) => {
        const next = { ...record };
        delete next[scope];
        return next;
      };
      set({
        browserProfiles: state.browserProfiles.filter((item) => item.id !== id),
        layoutsByScope: without(state.layoutsByScope),
      });
      return profile.dataId;
    },
    selectBrowserProfile(id) {
      const state = get();
      if (id && !state.browserProfiles.some((profile) => profile.id === id)) return false;
      const update = switchWorkspaceScope(state, id ? profileScopeKey(id) : windowSpaceScope());
      if (update) set(update);
      return true;
    },
  };
}
