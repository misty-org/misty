import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { hasTauriInternals } from "@/shared/platform/tauri";

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

export function isProfileWindowLabel(label: string): boolean {
  return /^window-[1-9][0-9]*$/.test(label);
}

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

export const useProfileWindowStore = create<WindowIdentity>(() => openingIdentity());

export function currentProfile(): ProfileEntry {
  return useProfileWindowStore.getState().profile;
}

export function currentWindowId(): string {
  return useProfileWindowStore.getState().windowId;
}

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

export function startProfileWindow() {
  if (started || !hasTauriInternals()) return;
  started = true;
  void refreshProfileWindow();
  void listen("misty://profiles-changed", () => void refreshProfileWindow()).catch(() => undefined);
}

export function isHostWindow(): Promise<boolean> {
  if (!hasTauriInternals()) return Promise.resolve(false);
  return invoke<boolean>("profile_window_is_host").catch(() => false);
}

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

export async function isLinkTargetWindow(): Promise<boolean> {
  if (!hasTauriInternals()) return true;
  return invoke<boolean>("profile_window_link_target").catch(() => false);
}

export function openNewWindow() {
  return invoke("profile_window_new");
}

export function closeWindow() {
  return invoke("profile_window_close");
}
