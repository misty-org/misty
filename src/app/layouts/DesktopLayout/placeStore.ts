import { useEffect } from "react";
import { create } from "zustand";
import {
  onSpaceWindowSwitch,
  spaceWindow,
  switchSpaceWindow,
  useSpaceWindowStore,
} from "@/features/app-windows";
import { useSpacesStore, useWindowSpace } from "@/features/spaces";
import { createDeviceSetting } from "@/shared/lib/deviceSetting";

/**
 * Which side of Misty the sidebar shows: the person's Personal (private for good: friends and
 * direct messages), or their shared Spaces. Personal is the account's own Space (`is_default`);
 * a shared Space is any other.
 */
export type Place = "personal" | "spaces";

/** The shared Space this device showed last, so Spaces opens where the person left it. */
const lastSharedSpace = createDeviceSetting<string>({
  scope: "sidebar-last-shared-space",
  defaults: "",
  normalize: (stored) => (typeof stored === "string" ? stored : ""),
});

/**
 * The side the person picked. It follows the window's Space (switching to a shared one is the
 * Spaces side), and stays on Spaces while the person has no shared Space to show there.
 */
const usePlaceStore = create<{ place: Place }>(() => ({
  place: spaceWindow().personal ? "personal" : "spaces",
}));

onSpaceWindowSwitch((next) => {
  usePlaceStore.setState({ place: next.personal ? "personal" : "spaces" });
  if (!next.personal && next.spaceId) lastSharedSpace.getState().set(next.spaceId);
});

/**
 * The side the sidebar shows now. A window opened on the Personal Space by its id (not as
 * "personal") still shows Personal.
 */
export function usePlace(): Place {
  const place = usePlaceStore((state) => state.place);
  const personalWindow = useSpaceWindowStore((state) => state.identity.personal);
  const space = useWindowSpace();
  return place === "personal" || (!personalWindow && space?.is_default) ? "personal" : "spaces";
}

/** The person's shared Spaces, the ones the Spaces side lists. */
export function useSharedSpaces() {
  const spaces = useSpacesStore((state) => state.spaces);
  return spaces.filter((space) => !space.is_default);
}

/**
 * Shows that side in this window: Personal is the person's own Space; Spaces is the shared Space
 * shown last, else the first. With no shared Space the side shows its empty state, and the
 * window keeps its Space.
 */
export function choosePlace(place: Place) {
  const spaces = useSpacesStore.getState().spaces;
  if (place === "personal") {
    const personal =
      spaces.find((space) => space.is_default && space.role === "owner") ??
      spaces.find((space) => space.is_default);
    usePlaceStore.setState({ place: "personal" });
    if (personal && !spaceWindow().personal) switchSpaceWindow(personal.id, true);
    return;
  }
  const shared = spaces.filter((space) => !space.is_default);
  const last = lastSharedSpace.getState().value;
  const target = shared.find((space) => space.id === last) ?? shared[0];
  usePlaceStore.setState({ place: "spaces" });
  if (target && spaceWindow().spaceId !== target.id) switchSpaceWindow(target.id, false);
}

/**
 * On the Spaces side while the window still shows Personal (the shared Spaces hadn't loaded, or
 * the person had none and just made or joined one), shows the shared Space as soon as there is one.
 */
export function useSpacesSideFollowsSpaces() {
  const place = usePlaceStore((state) => state.place);
  const personalWindow = useSpaceWindowStore((state) => state.identity.personal);
  const hasShared = useSpacesStore((state) => state.spaces.some((space) => !space.is_default));
  useEffect(() => {
    if (place === "spaces" && personalWindow && hasShared) choosePlace("spaces");
  }, [place, personalWindow, hasShared]);
}
