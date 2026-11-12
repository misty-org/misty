import { useEffect } from "react";
import { useSpacesStore } from "@/features/spaces/core";
import { startProfileWindow } from "@/features/app-windows";
import {
  notePersonalSpace,
  preferredDefaultSpace,
  spaceWindow,
  switchSpaceWindow,
} from "@/features/app-windows";

/**
 * Starts this window's identity, and keeps its current Space real: a Space that no longer exists
 * (left, or deleted) falls back to the personal Space. It also tells the window which Space is the
 * personal one, so what is made there carries that Space's id. Spaces own no tabs, so nothing else
 * happens here.
 */
export function SpaceWindowBridge() {
  const spaces = useSpacesStore((state) => state.spaces);
  const ready = useSpacesStore((state) => state.snapshotReady);
  useEffect(() => startProfileWindow(), []);
  // Until this account's Spaces load, no Space counts as personal, so nothing made or placed in the
  // meantime takes another account's.
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
