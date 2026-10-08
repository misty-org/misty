import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSpacesStore } from "@/features/spaces/core";
import { preferredDefaultSpace } from "@/features/spaces/defaultSpace";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { startSpaceWindow, spaceWindow } from "./spaceWindow";

/**
 * Loads this window's Space (name and color) and tells the native side which Spaces the
 * account has, so the Window menu, the Dock menu and ⌘⇧N can list them.
 */
export function SpaceWindowBridge() {
  const spaces = useSpacesStore((state) => state.spaces);
  useEffect(() => startSpaceWindow(), []);
  useEffect(() => {
    if (!hasTauriInternals() || spaceWindow().incognito || !spaces.length) return;
    const personal = preferredDefaultSpace(spaces);
    void invoke("space_windows_set_spaces", {
      spaces: spaces.map((space) => ({
        id: space.id,
        personal: space.id === personal?.id,
        name: space.name,
      })),
    }).catch(() => undefined);
  }, [spaces]);
  return null;
}
