import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/features/account";
import { useWorkspaceViewFocused } from "@/features/app-windows";
import type { WorkspaceView } from "@/features/app-windows/core";
import { SpaceOverviewProvider } from "./useSpaceOverview";
import { Button, Surface, Text, useNotice } from "@/shared/ui";
import { GlobalCreateSpaceDialog } from "../create/GlobalCreateSpaceDialog";
import { SpaceSectionView } from "./SpaceSectionView";
import { preferredDefaultSpace, windowSpace } from "../routes/defaultSpace";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { defaultSpaceRoute } from "../routes/defaultSpaceRoute";
import { useSpacesStore } from "../list/useSpacesStore";
import { useSpaceRoute } from "../routes/spaceRoute";
import { SpacePageLoadingPlaceholder } from "../components/SpacePageLoadingPlaceholder";
import { SpacePageShortcuts } from "../components/SpacePageShortcuts";
import { SpaceInvitationsNotice } from "../create/SpaceInvitationsNotice";
/** Each Space pane owns its navigation and content. */
export function SpaceWorkspaceSurface({ tab }: { tab: WorkspaceView }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const setViewingSpace = useSpacesStore((state) => state.setViewingSpace);
  const route = useSpaceRoute();
  const spaces = useSpacesStore((state) => state.spaces);
  const ready = useSpacesStore((state) => state.snapshotReady);
  const error = useSpacesStore((state) => state.error);
  const load = useSpacesStore((state) => state.load);
  const invitations = useSpacesStore((state) => state.invitations);
  const respondInvite = useSpacesStore((state) => state.respondInvite);
  const space = spaces.find((item) => item.id === route.activeSpaceId);
  // Any Space opens here, in this tab; a bare route lands on the window's current one.
  const fallback = hasTauriInternals() ? windowSpace(spaces) : preferredDefaultSpace(spaces);
  const [inviteError, setInviteError] = useState("");
  useNotice(Boolean(user) && !ready && Boolean(error), {
    message: "Spaces could not be loaded.",
    tone: "error",
    action: { label: "Retry", onSelect: () => void load({ force: true }) },
  });
  useNotice(Boolean(inviteError), {
    message: inviteError,
    tone: "error",
    onDismiss: () => setInviteError(""),
  });
  useEffect(() => {
    if (!route.activeSpaceId && ready && fallback) {
      navigate(defaultSpaceRoute(fallback.id), { replace: true });
    }
  }, [fallback, ready, route.activeSpaceId, navigate]);
  useEffect(() => {
    if (!route.activeSpaceId) return;
    const base = `/spaces/${encodeURIComponent(route.activeSpaceId)}`;
    if (location.pathname === base) {
      navigate(`${base}/home${location.search}${location.hash}`, { replace: true });
    }
  }, [location.hash, location.pathname, location.search, navigate, route.activeSpaceId]);

  // Signed out, the window shows only the sign-in pages.
  if (!user) return null;

  // The Spaces are read for the first time, with nothing saved: the page the route opens, in
  // that page's own shape (the home's top bar, page tiles and panels, a chat, a doc, …).
  if (!ready)
    return (
      <Surface tone="page" className="flex h-full min-h-0 flex-col overflow-hidden">
        <SpacePageLoadingPlaceholder
          shape={{
            section: route.section || "home",
            item: Boolean(route.drawingId) || new URLSearchParams(location.search).has("note"),
          }}
        />
      </Surface>
    );

  if (!route.activeSpaceId)
    return (
      <GlobalCreateSpaceDialog>
        {(create) => (
          <div className="grid h-full place-content-center gap-4 p-6 text-center">
            <h1 className="text-xl font-semibold">Your project Spaces</h1>
            <Text tone="muted" wrap className="text-sm">
              Chat, plan, and keep project materials together.
            </Text>
            <SpaceInvitationsNotice
              invitations={invitations}
              onRespond={(id, accept) => {
                void respondInvite(id, accept).catch((reason: unknown) =>
                  setInviteError(
                    reason instanceof Error ? reason.message : "Could not respond to invitation.",
                  ),
                );
              }}
            />
            <Button size="lg" onClick={create}>
              Create Space
            </Button>
          </div>
        )}
      </GlobalCreateSpaceDialog>
    );

  if (!space)
    return (
      <Text tone="muted" wrap className="p-6 text-sm">
        This Space is unavailable.
      </Text>
    );
  return (
    <SpaceOverviewProvider accountId={user.id} space={space}>
      <ViewingSpace spaceId={space.id} onView={setViewingSpace} />
      <Surface
        as="section"
        tone="page"
        className="relative flex h-full min-h-0 min-w-0 overflow-hidden"
        data-space-workspace={route.activeSpaceId}
        aria-label={`${space?.name ?? "Space"} workspace`}
      >
        {/* The Space row in the sidebar carries the Space's controls; the page has no bar. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <SpacePageShortcuts space={space} />
          <div className="min-h-0 flex-1 overflow-hidden">
            <SpaceSectionView
              spaceId={route.activeSpaceId}
              section={route.section}
              studioKind={route.drawingId}
              workspaceTabId={tab.id}
            />
          </div>
        </div>
      </Surface>
    </SpaceOverviewProvider>
  );
}

/**
 * Marks the Space as the one being viewed while this tab has focus. Focus is read here rather
 * than by the page, so a tab gaining or losing focus renders this alone, not the whole Space.
 */
function ViewingSpace(props: { spaceId: string; onView(spaceId: string): void }) {
  const focused = useWorkspaceViewFocused();
  const { spaceId, onView } = props;
  useEffect(() => {
    if (!focused) return;
    onView(spaceId);
    return () => onView("");
  }, [focused, spaceId, onView]);
  return null;
}
