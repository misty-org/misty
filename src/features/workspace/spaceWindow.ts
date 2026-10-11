import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { isWindowColor, type WindowColor } from "./windowColors";
import type { WorkspaceScopeKey } from "./model";

/**
 * A Misty window shows one Space at a time and can switch it in place, as Arc does. The
 * native side keeps which Space each window shows and changes it only through
 * `space_window_switch`; this module follows it. The window's tabs, the store its pages
 * open in, its extensions, sync, memory and agents all follow the current Space.
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

function validKey(key: unknown): key is string {
  return typeof key === "string" && (key === personalSpaceKey || /^[0-9a-f]{32}$/.test(key));
}

/** A window label's kind; window labels never name a Space. */
export function isIncognitoWindowLabel(label: string | null): boolean {
  return Boolean(label && /^incognito-[1-9][0-9]*$/.test(label));
}

/** An app window that isn't incognito (not an agent window or an overlay). */
export function isSpaceWindowLabel(label: string): boolean {
  return /^window-[1-9][0-9]*$/.test(label);
}

/** The identity of a window showing a Space. */
export function spaceWindowIdentity(key: string, incognito: boolean): SpaceWindowIdentity {
  const valid = validKey(key) ? key : personalSpaceKey;
  return {
    key: valid,
    spaceId: spaceIdFromKey(valid),
    personal: valid === personalSpaceKey,
    incognito,
  };
}

/** The Space the native side opened this window in, set before the app first renders. */
function openingIdentity(): SpaceWindowIdentity {
  const opening =
    typeof window === "undefined"
      ? undefined
      : (window as typeof window & { __MISTY_WINDOW_SPACE__?: { key?: unknown } })
          .__MISTY_WINDOW_SPACE__;
  return spaceWindowIdentity(
    validKey(opening?.key) ? opening.key : personalSpaceKey,
    isIncognitoWindowLabel(currentLabel()),
  );
}

/** This window's native label, as agent device contexts name it. */
export function currentWindowLabel(): string {
  return currentLabel() ?? "window-1";
}

let identity: SpaceWindowIdentity | undefined;
const identityListeners = new Set<
  (next: SpaceWindowIdentity, previous: SpaceWindowIdentity) => void
>();

/** The Space this window shows now. */
export function spaceWindow(): SpaceWindowIdentity {
  identity ??= openingIdentity();
  return identity;
}

/** Calls `listener` whenever this window switches to another Space. */
export function onSpaceWindowSwitch(
  listener: (next: SpaceWindowIdentity, previous: SpaceWindowIdentity) => void,
): () => void {
  identityListeners.add(listener);
  return () => identityListeners.delete(listener);
}

/** Follows a switch the native side made (or, in tests, stands in for one). */
export function followSpaceWindow(key: string) {
  showSpace(key);
}

function showSpace(key: string) {
  const previous = spaceWindow();
  if (previous.key === key || !validKey(key)) return;
  identity = spaceWindowIdentity(key, previous.incognito);
  useSpaceWindowStore.setState({ identity });
  for (const listener of identityListeners) listener(identity, previous);
}

/** The workspace scope of the Space this window shows: its tabs, panes and tab groups. */
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

/** The Space this window shows, with its name and color as this device keeps them. */
export const useSpaceWindowStore = create<{
  identity: SpaceWindowIdentity;
  space: SpaceWindowEntry | null;
}>(() => ({
  identity: spaceWindow(),
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
      if (!space) return;
      // After a reload the window may show another Space than it opened in.
      showSpace(space.key);
      useSpaceWindowStore.setState({ space });
    })
    .catch(() => undefined);
  void listen<unknown>("misty://space-window", ({ payload }) => {
    const space = entry(payload);
    if (!space) return;
    // The native side sends this window its Space's changes and its own switches.
    showSpace(space.key);
    if (space.key === spaceWindow().key) useSpaceWindowStore.setState({ space });
  }).catch(() => undefined);
}

/** Switches this window to another Space in place; its tabs swap to that Space's. */
export async function switchSpaceWindow(spaceId: string, personal: boolean) {
  const space = entry(await invoke<unknown>("space_window_switch", { spaceId, personal }));
  if (!space) return;
  showSpace(space.key);
  useSpaceWindowStore.setState({ space });
}

/** Whether this window runs the device's own background work (agent jobs). */
export function isHostWindow(): Promise<boolean> {
  if (!hasTauriInternals()) return Promise.resolve(false);
  return invoke<boolean>("space_window_is_host").catch(() => false);
}

/** Calls `listener` when this window becomes the host after the host closed. */
export function onHostWindow(listener: () => void): () => void {
  if (!hasTauriInternals()) return () => undefined;
  let stop: (() => void) | undefined;
  let stopped = false;
  void listen("misty://space-window-host", listener).then((unlisten) => {
    if (stopped) unlisten();
    else stop = unlisten;
  });
  return () => {
    stopped = true;
    stop?.();
  };
}

/** Sets this Space's color; every window of the Space takes it. */
export async function setSpaceColor(color: WindowColor) {
  const space = entry(await invoke<unknown>("space_window_set_color", { color }));
  if (space) useSpaceWindowStore.setState({ space });
}

/** Opens a new window showing a Space. */
export function openSpaceWindow(spaceId: string, personal: boolean) {
  return invoke("space_window_open", { spaceId, personal });
}

/** Opens an incognito window showing this window's Space. */
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
