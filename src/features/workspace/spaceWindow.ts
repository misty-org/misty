import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { isWindowColor, type WindowColor } from "./windowColors";
import type { WorkspaceScopeKey } from "./model";

/**
 * Every Misty window belongs to one Space, as every Chrome window belongs to one
 * profile. The native side names the window after its Space (`space-<key>`, or
 * `incognito-<key>-<n>` for an incognito window); this module reads that label once,
 * at boot, and never lets the renderer pick another Space.
 */
export const personalSpaceKey = "personal";

export interface SpaceWindowIdentity {
  /** `personal`, or the Space id's 32 hex digits. */
  key: string;
  /** The Space's id; unknown for the personal Space until the account's Spaces load. */
  spaceId: string | null;
  personal: boolean;
  incognito: boolean;
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

function spaceIdFromKey(key: string): string | null {
  if (!/^[0-9a-f]{32}$/.test(key)) return null;
  return `${key.slice(0, 8)}-${key.slice(8, 12)}-${key.slice(12, 16)}-${key.slice(16, 20)}-${key.slice(20)}`;
}

/** The Space a window label names; the personal Space outside the desktop app. */
export function parseSpaceWindowLabel(label: string | null): SpaceWindowIdentity {
  const space = label?.match(/^space-(personal|[0-9a-f]{32})$/);
  const incognito = label?.match(/^incognito-(personal|[0-9a-f]{32})-[1-9][0-9]*$/);
  const key = space?.[1] ?? incognito?.[1] ?? personalSpaceKey;
  return {
    key,
    spaceId: spaceIdFromKey(key),
    personal: key === personalSpaceKey,
    incognito: Boolean(incognito),
  };
}

/** This window's native label, as agent device contexts name it. */
export function currentWindowLabel(): string {
  return currentLabel() ?? `space-${personalSpaceKey}`;
}

/** A Space's own window (not incognito, an agent window or an overlay). */
export function isSpaceWindowLabel(label: string): boolean {
  return /^space-(personal|[0-9a-f]{32})$/.test(label);
}

let identity: SpaceWindowIdentity | undefined;

/** This window's Space, fixed for the life of the renderer. */
export function spaceWindow(): SpaceWindowIdentity {
  identity ??= parseSpaceWindowLabel(currentLabel());
  return identity;
}

/** The workspace scope of this window's Space: its tabs, panes and tab groups. */
export function windowSpaceScope(): WorkspaceScopeKey {
  return `space:${spaceWindow().spaceId ?? personalSpaceKey}`;
}

/** An incognito window keeps nothing: no recovery, sync, history, memory or agents. */
export function isIncognitoWindow(): boolean {
  return spaceWindow().incognito;
}

export interface SpaceWindowEntry {
  key: string;
  spaceId?: string;
  name: string;
  color?: WindowColor;
}

/** The Space's name and color, as this device keeps them. */
export const useSpaceWindowStore = create<{ space: SpaceWindowEntry | null }>(() => ({
  space: null,
}));

function entry(value: unknown): SpaceWindowEntry | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.key !== "string" || typeof candidate.name !== "string") return null;
  return {
    key: candidate.key,
    name: candidate.name,
    spaceId: typeof candidate.spaceId === "string" ? candidate.spaceId : undefined,
    color: isWindowColor(candidate.color) ? candidate.color : undefined,
  };
}

let started = false;

/** Loads this window's Space from the native side and follows its changes. */
export function startSpaceWindow() {
  if (started || !hasTauriInternals()) return;
  started = true;
  void invoke<{ space: unknown }>("space_window_info")
    .then((info) => {
      const space = entry(info.space);
      if (space) useSpaceWindowStore.setState({ space });
    })
    .catch(() => undefined);
  void listen<unknown>("misty://space-window", ({ payload }) => {
    const space = entry(payload);
    if (space && space.key === spaceWindow().key) useSpaceWindowStore.setState({ space });
  }).catch(() => undefined);
}

/** Sets this Space's color; every window of the Space takes it. */
export async function setSpaceColor(color: WindowColor) {
  const space = entry(await invoke<unknown>("space_window_set_color", { color }));
  if (space) useSpaceWindowStore.setState({ space });
}

/** Opens or focuses a Space's window. */
export function openSpaceWindow(spaceId: string, personal: boolean) {
  return invoke("space_window_open", { spaceId, personal });
}

/** Opens an incognito window in this window's Space. */
export function openIncognitoWindow() {
  return invoke("space_incognito_open");
}

/** Closes this window. Its Space keeps its tabs for the next time it opens. */
export function closeSpaceWindow() {
  return invoke("space_window_close");
}

/** Shows the Spaces menu at the pointer (⌘⇧N). */
export function showSpacesMenu() {
  return invoke("space_windows_menu");
}

/** Whether links other apps hand to Misty open in this window. */
export async function isLinkTargetWindow(): Promise<boolean> {
  if (!hasTauriInternals()) return true;
  return invoke<boolean>("space_window_link_target").catch(() => false);
}
