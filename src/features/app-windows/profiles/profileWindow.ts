import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { isWindowColor, type WindowColor } from "./windowColors";

/**
 * A Misty window belongs to one profile for its whole life, as in Chrome: its tabs, the store
 * its pages open in, its extensions and its saved data are that profile's. The native side
 * decides who a window is and tells it before the app first renders; this module holds that
 * identity and is the only way to open, close or change windows and profiles.
 */

/** The first profile's id, the same on every computer. It can't be deleted. */
export const firstProfileId = "personal";

export interface ProfileEntry {
  id: string;
  name: string;
  /** Tints the window's chrome. */
  color?: WindowColor;
  order: number;
  /** The sites this profile claims for links from other apps. */
  sites: string[];
}

interface WindowIdentity {
  windowId: string;
  profile: ProfileEntry;
}

interface OpeningWindow {
  windowId?: unknown;
  profile?: unknown;
  space?: unknown;
}

function currentLabel(): string | null {
  if (typeof window === "undefined") return null;
  const internals = (
    window as typeof window & {
      __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } };
    }
  ).__TAURI_INTERNALS__;
  return internals?.metadata?.currentWindow?.label ?? null;
}

/** An app window (not an overlay). */
export function isProfileWindowLabel(label: string): boolean {
  return /^window-[1-9][0-9]*$/.test(label);
}

/** A profile as the native side sends it; `null` for anything else. */
export function parseProfileEntry(value: unknown): ProfileEntry | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== "string" || typeof candidate.name !== "string") return null;
  return {
    id: candidate.id,
    name: candidate.name,
    color: isWindowColor(candidate.color) ? candidate.color : undefined,
    order: typeof candidate.order === "number" ? candidate.order : 0,
    sites: Array.isArray(candidate.sites)
      ? candidate.sites.filter((site): site is string => typeof site === "string")
      : [],
  };
}

function openingWindow(): OpeningWindow | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as typeof window & { __MISTY_WINDOW__?: OpeningWindow }).__MISTY_WINDOW__;
}

/** The Space the native side remembers for this window, from when it last closed. */
export function openingSpaceKey(): string | null {
  const space = openingWindow()?.space;
  return typeof space === "string" ? space : null;
}

function openingIdentity(): WindowIdentity {
  const opening = openingWindow();
  return {
    windowId: typeof opening?.windowId === "string" ? opening.windowId : "local",
    profile: parseProfileEntry(opening?.profile) ?? {
      id: firstProfileId,
      name: "Personal",
      order: 0,
      sites: [],
    },
  };
}

/** Who this window is, and the profiles a menu can offer. */
export const useProfileWindowStore = create<WindowIdentity & { profiles: ProfileEntry[] }>(() => ({
  ...openingIdentity(),
  profiles: [],
}));

/** The profile this window belongs to. */
export function currentProfile(): ProfileEntry {
  return useProfileWindowStore.getState().profile;
}

/** Names this window's saved tabs. Stable across launches, unlike its label. */
export function currentWindowId(): string {
  return useProfileWindowStore.getState().windowId;
}

/** This window's native label, as agent device contexts name it. */
export function currentWindowLabel(): string {
  return currentLabel() ?? "window-1";
}

/** Reads who this window is from the native side: after an account change its profile can differ. */
export async function refreshProfileWindow(): Promise<void> {
  if (!hasTauriInternals()) return;
  const info = await invoke<{
    windowId: string;
    profile: unknown;
  }>("profile_window_info").catch(() => null);
  const profile = parseProfileEntry(info?.profile);
  if (!info || !profile) return;
  useProfileWindowStore.setState({
    windowId: info.windowId,
    profile,
  });
}

export async function listProfiles(): Promise<ProfileEntry[]> {
  const listed = await invoke<unknown[]>("profiles_list");
  return listed
    .map(parseProfileEntry)
    .filter((profile): profile is ProfileEntry => profile !== null)
    .sort((a, b) => a.order - b.order);
}

async function refreshProfiles(): Promise<void> {
  const profiles = await listProfiles().catch(() => null);
  if (profiles) useProfileWindowStore.setState({ profiles });
}

let started = false;

/** Loads this window's identity and the profile list, and follows their changes. */
export function startProfileWindow() {
  if (started || !hasTauriInternals()) return;
  started = true;
  void refreshProfileWindow();
  void refreshProfiles();
  void listen<unknown>("misty://profile-window", ({ payload }) => {
    const profile = parseProfileEntry(payload);
    if (profile && profile.id === currentProfile().id) useProfileWindowStore.setState({ profile });
  }).catch(() => undefined);
  void listen("misty://profiles-changed", () => {
    void refreshProfiles();
    void refreshProfileWindow();
  }).catch(() => undefined);
}

/** Whether this window runs the computer's own background work (agent jobs). */
export function isHostWindow(): Promise<boolean> {
  if (!hasTauriInternals()) return Promise.resolve(false);
  return invoke<boolean>("profile_window_is_host").catch(() => false);
}

/** Calls `listener` when this window becomes the host after the host closed. */
export function onHostWindow(listener: () => void): () => void {
  if (!hasTauriInternals()) return () => undefined;
  let stop: (() => void) | undefined;
  let stopped = false;
  void listen("misty://profile-window-host", listener).then((unlisten) => {
    if (stopped) unlisten();
    else stop = unlisten;
  });
  return () => {
    stopped = true;
    stop?.();
  };
}

/** Whether links other apps hand to Misty open in this window. */
export async function isLinkTargetWindow(): Promise<boolean> {
  if (!hasTauriInternals()) return true;
  return invoke<boolean>("profile_window_link_target").catch(() => false);
}

/** Opens another window of this window's profile. */
export function openNewWindow() {
  return invoke("profile_window_new");
}

/** Closes this window. Its tabs stay in the profile. */
export function closeWindow() {
  return invoke("profile_window_close");
}

/** Brings a window of the profile forward, opening one if none is open. Tabs never swap. */
export function openProfile(id: string) {
  return invoke("profile_open", { id });
}

async function savedProfile(request: Promise<unknown>): Promise<ProfileEntry> {
  const profile = parseProfileEntry(await request);
  if (!profile) throw new Error("The profile couldn't be read.");
  if (profile.id === currentProfile().id) useProfileWindowStore.setState({ profile });
  return profile;
}

/** Adds a profile and opens its first window. */
export function createProfile(name: string, color?: WindowColor): Promise<ProfileEntry> {
  return savedProfile(invoke("profile_create", { name, color: color ?? null }));
}

export function renameProfile(id: string, name: string): Promise<ProfileEntry> {
  return savedProfile(invoke("profile_rename", { id, name }));
}

export function setProfileColor(id: string, color: WindowColor): Promise<ProfileEntry> {
  return savedProfile(invoke("profile_set_color", { id, color }));
}

/** Removes a profile and everything it keeps on this computer. */
export function deleteProfile(id: string) {
  return invoke("profile_delete", { id });
}

/** The sites links from other apps open in this profile's windows for. */
export function profileSites(id: string) {
  return invoke<string[]>("profile_sites", { id });
}

export function setProfileSites(id: string, sites: string[]) {
  return invoke<string[]>("profile_set_sites", { id, sites });
}
