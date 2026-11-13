import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { hasTauriInternals } from "@/shared/platform/tauri";

/**
 * A Misty window belongs to one profile for its whole life, as in Chrome: its tabs, the store
 * its pages open in, its extensions and its saved data are that profile's. The native side
 * decides who a window is and tells it before the app first renders; this module holds that
 * identity and opens and closes windows. The native Window menu lists the profiles.
 */

/** The first profile's id, the same on every computer. It can't be deleted. */
export const firstProfileId = "personal";

export interface ProfileEntry {
  id: string;
  name: string;
  order: number;
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
    order: typeof candidate.order === "number" ? candidate.order : 0,
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
    },
  };
}

/** Who this window is. */
export const useProfileWindowStore = create<WindowIdentity>(() => openingIdentity());

/** The profile this window belongs to. */
export function currentProfile(): ProfileEntry {
  return useProfileWindowStore.getState().profile;
}

/** Names this window's saved tabs. Stable across launches, unlike its label. */
export function currentWindowId(): string {
  return useProfileWindowStore.getState().windowId;
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

let started = false;

/** Loads this window's identity and reloads it when the profiles change. */
export function startProfileWindow() {
  if (started || !hasTauriInternals()) return;
  started = true;
  void refreshProfileWindow();
  void listen("misty://profiles-changed", () => void refreshProfileWindow()).catch(() => undefined);
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
