import { useEffect } from "react";
import { useSpacesStore } from "@/features/spaces/core";
import { startProfileWindow } from "@/features/app-windows";
import {
  notePersonalSpace,
  preferredDefaultSpace,
  spaceWindow,
  switchSpaceWindow,
} from "@/features/app-windows";

export function SpaceWindowBridge() {
  const spaces = useSpacesStore((state) => state.spaces);
  const ready = useSpacesStore((state) => state.snapshotReady);
  useEffect(() => startProfileWindow(), []);
  useEffect(() => {
    notePersonalSpace(ready ? (preferredDefaultSpace(spaces) ?? null) : null);
  }, [ready, spaces]);
  useEffect(() => {
    const current = spaceWindow();
    if (!ready || current.personal) return;
    if (!spaces.some((space) => space.id === current.spaceId)) switchSpaceWindow("", true);
  }, [ready, spaces]);
  return null;
}
