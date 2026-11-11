import type { ReactNode } from "react";
import type { TabSide } from "@/app/shell/dockingLayout";
import { openSignInSheet, useAuth } from "@/features/account";
import { ProfileSwitcher, type WorkspaceView } from "@/features/app-windows";
import { SpaceRow, SpaceRowPreview } from "@/features/spaces";
import { useBrowserToolbarSlot } from "@/features/browser";
import { OverlaySideProvider, inwardSide } from "@/shared/ui";
import { SidebarNavFallback } from "./SidebarFallbacks";
import { SidebarToggleButton } from "./SidebarToggleButton";
import { LayoutButton } from "./SidebarToolsRow";
import { SpaceNavigator } from "./SpaceNavigator";
import { windowsCaptionSlotId } from "./WindowsTitlebarControls";

const setNavSlot = (element: HTMLDivElement | null) =>
  useBrowserToolbarSlot.getState().setNav(element);

/**
 * The window's sidebar: which Space this is, its pages, then the person's chats under each of
 * their agents, with the account at the foot. The layout button sits in the head beside back and
 * forward; there is no agents side panel, since the chats are right here. It lists no tabs and has no address
 * field; web pages belong to agents, and every row opens in the focused pane.
 */
export function WorkspaceSidebar(props: {
  position?: TabSide;
  windowsTitlebarControls?: boolean;
  onOpen(view: WorkspaceView): void;
  account?: ReactNode;
}) {
  const position = props.position ?? "left";
  const { user, sessionExpired } = useAuth();
  // An expired session loads no Spaces, so it asks to sign in like being signed out does.
  const signedIn = Boolean(user) && !sessionExpired;
  return (
    <OverlaySideProvider value={inwardSide[position]}>
      <header
        data-tab-position={position}
        className="misty-workspace-tabs flex min-w-0 shrink-0 border-charcoal-border bg-[var(--misty-window-chrome,var(--color-charcoal-workspace))]"
      >
        <div className="misty-sidebar-card">
          <div className="misty-sidebar-head" data-misty-window-titlebar-region="true">
            {props.windowsTitlebarControls ? (
              <div id={windowsCaptionSlotId} className="flex shrink-0 items-center" />
            ) : null}
            <SidebarToggleButton side={position} />
            <LayoutButton />
            <div className="misty-sidebar-nav flex items-center">
              <div ref={setNavSlot} className="flex items-center" />
              <SidebarNavFallback />
            </div>
          </div>
          {/* Which Space this is, and the way to another. */}
          <div className="misty-sidebar-space" data-misty-window-drag-block="true">
            {signedIn ? (
              <SpaceRow labeled />
            ) : (
              <SpaceRowPreview
                onSignIn={() =>
                  sessionExpired
                    ? openSignInSheet("expired", user?.email)
                    : openSignInSheet("space")
                }
              />
            )}
          </div>
          <SpaceNavigator onOpen={props.onOpen} />
          <div className="misty-sidebar-foot" data-misty-window-drag-block="true">
            <div className="flex min-w-0 flex-1 justify-center" data-browser-toolbar data-sidebar>
              <ProfileSwitcher />
            </div>
          </div>
          {props.account}
        </div>
      </header>
    </OverlaySideProvider>
  );
}
