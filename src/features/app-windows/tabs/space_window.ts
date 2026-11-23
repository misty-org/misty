import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { openingSpaceKey } from "../profiles/profile_window";

const personalSpaceKey = "personal";

export interface SpaceWindowIdentity {
  key: string;
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

export const useSpaceWindowStore = create<{
  identity: SpaceWindowIdentity;
  personalSpaceId: string | null;
  personalSpaceOwner: string | null;
}>(() => ({
  identity: identityFor(openingSpaceKey() ?? personalSpaceKey),
  personalSpaceId: null,
  personalSpaceOwner: null,
}));

export function personalSpaceId(): string | null {
  return useSpaceWindowStore.getState().personalSpaceId;
}

export function notePersonalSpace(space: { id: string; owner_user_id: string } | null) {
  const id = space?.id ?? null;
  const owner = space?.owner_user_id ?? null;
  const known = useSpaceWindowStore.getState();
  if (known.personalSpaceId !== id || known.personalSpaceOwner !== owner)
    useSpaceWindowStore.setState({ personalSpaceId: id, personalSpaceOwner: owner });
}

export function spaceForNewItems(): { spaceId: string | null; personal: boolean } {
  const { identity, personalSpaceId: personalId } = useSpaceWindowStore.getState();
  return identity.personal
    ? { spaceId: personalId, personal: true }
    : { spaceId: identity.spaceId, personal: false };
}

const listeners = new Set<(next: SpaceWindowIdentity, previous: SpaceWindowIdentity) => void>();

export function spaceWindow(): SpaceWindowIdentity {
  return useSpaceWindowStore.getState().identity;
}

export function onSpaceWindowSwitch(
  listener: (next: SpaceWindowIdentity, previous: SpaceWindowIdentity) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function followSpaceWindow(key: string) {
  const previous = spaceWindow();
  if (previous.key === key || !validKey(key)) return;
  const identity = identityFor(key);
  useSpaceWindowStore.setState({ identity });
  for (const listener of listeners) listener(identity, previous);
}

export function switchSpaceWindow(spaceId: string, personal: boolean) {
  const key = personal ? personalSpaceKey : spaceId;
  followSpaceWindow(key);
  if (!hasTauriInternals()) return;
  void invoke("profile_window_set_space", { space: personal ? null : key }).catch(() => undefined);
}
