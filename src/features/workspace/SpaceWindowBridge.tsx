import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSpacesStore } from "@/features/spaces/core";
import { preferredDefaultSpace } from "@/features/spaces/defaultSpace";
import { hasTauriInternals } from "@/shared/platform/tauri";
import {
  onSpaceWindowSwitch,
  personalSpaceKey,
  startSpaceWindow,
  spaceWindow,
  type SpaceWindowIdentity,
} from "./spaceWindow";
import { useWorkspaceStore } from "./useWorkspaceStore";
import { recoveredSpaceLayout } from "./nativeWorkspaceRecovery";
import { withActiveWindowLayout } from "./windows";
import type { WorkspaceScopeKey } from "./model";

const scopeOf = (space: SpaceWindowIdentity): WorkspaceScopeKey =>
  `space:${space.spaceId ?? personalSpaceKey}`;

/**
 * Loads this window's Space (name and color), swaps the window's tabs when it switches
 * Space, and tells the native side which Spaces the account has, so the Window menu,
 * the Dock menu and the Space menus can list them.
 */
export function SpaceWindowBridge() {
  const spaces = useSpacesStore((state) => state.spaces);
  useEffect(() => startSpaceWindow(), []);
  useEffect(
    () =>
      onSpaceWindowSwitch((next) => {
        const scope = scopeOf(next);
        const before = useWorkspaceStore.getState();
        const known = Boolean(before.layoutsByScope[scope]);
        before.showSpace(scope);
        if (known || next.incognito) return;
        // A Space this window hasn't shown yet brings back the tabs it last had here,
        // unless sync or the person changed them first.
        const fresh = useWorkspaceStore.getState().layout;
        void recoveredSpaceLayout(next, scope).then((layout) => {
          const now = useWorkspaceStore.getState();
          if (!layout || now.activeScopeKey !== scope || now.layout !== fresh) return;
          useWorkspaceStore.setState(withActiveWindowLayout(now, layout));
        });
      }),
    [],
  );
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
