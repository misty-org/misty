import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { openingSpaceKey } from "../profiles/profileWindow";

/**
 * Which Space a window shows. A Space is shared content and owns no tabs, so this belongs to the
 * renderer and only decides what the Space row and panels show and where new agent conversations
 * go. Switching it never touches tabs. The native side only remembers it for the next launch.
 */
const personalSpaceKey = "personal";

export interface SpaceWindowIdentity {
  /** `personal`, or the Space's id. */
  key: string;
  /** The Space's id; unknown for the personal Space until the account's Spaces load. */
  spaceId: string | null;
  personal: boolean;
}

function validKey(key: unknown): key is string {
  return typeof key === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(key);
}

function identityFor(key: string): SpaceWindowIdentity {
  const valid = validKey(key) ? key : personalSpaceKey;
  const personal = valid === personalSpaceKey;
  return { key: valid, spaceId: personal ? null : valid, personal };
}

/** The current Space of this window, and a store for surfaces that follow it. */
export const useSpaceWindowStore = create<{
  identity: SpaceWindowIdentity;
  /** The personal Space's id, once the account's Spaces have loaded. */
  personalSpaceId: string | null;
  /** Whose personal Space that is, so one account's id never lands on another's chats. */
  personalSpaceOwner: string | null;
}>(() => ({
  identity: identityFor(openingSpaceKey() ?? personalSpaceKey),
  personalSpaceId: null,
  personalSpaceOwner: null,
}));

/** The personal Space's id, or null until the account's Spaces load. */
export function personalSpaceId(): string | null {
  return useSpaceWindowStore.getState().personalSpaceId;
}

/** Records which Space is the person's personal one, and whose, as the account's Spaces load. */
export function notePersonalSpace(space: { id: string; owner_user_id: string } | null) {
  const id = space?.id ?? null;
  const owner = space?.owner_user_id ?? null;
  const known = useSpaceWindowStore.getState();
  if (known.personalSpaceId !== id || known.personalSpaceOwner !== owner)
    useSpaceWindowStore.setState({ personalSpaceId: id, personalSpaceOwner: owner });
}

/**
 * The Space a new thing made in this window belongs to: its id, and whether it is the personal
 * Space. The id is null only in the personal Space before the account's Spaces load.
 */
export function spaceForNewItems(): { spaceId: string | null; personal: boolean } {
  const { identity, personalSpaceId: personalId } = useSpaceWindowStore.getState();
  return identity.personal
    ? { spaceId: personalId, personal: true }
    : { spaceId: identity.spaceId, personal: false };
}

const listeners = new Set<(next: SpaceWindowIdentity, previous: SpaceWindowIdentity) => void>();

/** The Space this window shows now. */
export function spaceWindow(): SpaceWindowIdentity {
  return useSpaceWindowStore.getState().identity;
}

/** Calls `listener` whenever this window shows another Space. */
export function onSpaceWindowSwitch(
  listener: (next: SpaceWindowIdentity, previous: SpaceWindowIdentity) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Shows another Space here, without remembering it. */
export function followSpaceWindow(key: string) {
  const previous = spaceWindow();
  if (previous.key === key || !validKey(key)) return;
  const identity = identityFor(key);
  useSpaceWindowStore.setState({ identity });
  for (const listener of listeners) listener(identity, previous);
}

/** Shows another Space in this window and remembers it for the next launch. Tabs stay as they are. */
export function switchSpaceWindow(spaceId: string, personal: boolean) {
  const key = personal ? personalSpaceKey : spaceId;
  followSpaceWindow(key);
  if (!hasTauriInternals()) return;
  void invoke("profile_window_set_space", { space: personal ? null : key }).catch(() => undefined);
}
