import { useEffect } from "react";
import { create } from "zustand";
import {
  onSpaceWindowSwitch,
  spaceWindow,
  switchSpaceWindow,
  useSpaceWindowStore,
} from "@/features/app-windows";
import { useSpacesStore, useWindowSpace } from "@/features/spaces";
import { createDeviceSetting } from "@/shared/lib/device_setting";

export type Place = "personal" | "spaces";

const lastSharedSpace = createDeviceSetting<string>({
  scope: "sidebar-last-shared-space",
  defaults: "",
  normalize: (stored) => (typeof stored === "string" ? stored : ""),
});

const usePlaceStore = create<{ place: Place }>(() => ({
  place: spaceWindow().personal ? "personal" : "spaces",
}));

onSpaceWindowSwitch((next) => {
  usePlaceStore.setState({ place: next.personal ? "personal" : "spaces" });
  if (!next.personal && next.spaceId) lastSharedSpace.getState().set(next.spaceId);
});

export function usePlace(): Place {
  const place = usePlaceStore((state) => state.place);
  const personalWindow = useSpaceWindowStore((state) => state.identity.personal);
  const space = useWindowSpace();
  return place === "personal" || (!personalWindow && space?.is_default) ? "personal" : "spaces";
}

export function useSharedSpaces() {
  const spaces = useSpacesStore((state) => state.spaces);
  return spaces.filter((space) => !space.is_default);
}

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

export function useSpacesSideFollowsSpaces() {
  const place = usePlaceStore((state) => state.place);
  const personalWindow = useSpaceWindowStore((state) => state.identity.personal);
  const hasShared = useSpacesStore((state) => state.spaces.some((space) => !space.is_default));
  useEffect(() => {
    if (place === "spaces" && personalWindow && hasShared) choosePlace("spaces");
  }, [place, personalWindow, hasShared]);
}
