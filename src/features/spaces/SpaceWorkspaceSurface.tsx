import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { openSignInSheet, useAuth } from "@/features/auth";
import { useWorkspaceViewFocused } from "@/features/workspace/WorkspaceViewRouteScope";
import type { WorkspaceView } from "@/features/workspace/core";
import { SpaceOverviewProvider } from "./useSpaceOverview";
import { Button, CollectionSkeleton, Skeleton } from "@/shared/ui";
import { GlobalCreateSpaceDialog } from "./GlobalCreateSpaceDialog";
import { SpaceSectionView } from "./SpaceSectionView";
import { preferredDefaultSpace, windowSpace } from "./defaultSpace";
import { openSpaceWindow } from "@/features/workspace/spaceWindow";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { defaultSpaceRoute } from "./defaultSpaceRoute";
import { useSpacesStore } from "./store/useSpacesStore";
import { useSpaceRoute } from "./spaceRoute";
import { SpacePageShortcuts } from "./components/SpacePageShortcuts";
import { SpaceInvitationsNotice } from "./spacesShell/SpaceInvitationsNotice";
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
  // A window shows only its own Space; another Space opens in its own window.
  const fallback = hasTauriInternals() ? windowSpace(spaces) : preferredDefaultSpace(spaces);
  const elsewhere = Boolean(
    ready && fallback && route.activeSpaceId && route.activeSpaceId !== fallback.id,
  );
  const [inviteError, setInviteError] = useState("");
  useEffect(() => {
    if (!route.activeSpaceId && ready && fallback) {
      navigate(defaultSpaceRoute(fallback.id), { replace: true });
    }
  }, [fallback, ready, route.activeSpaceId, navigate]);
  useEffect(() => {
    if (!elsewhere || !fallback || !hasTauriInternals()) return;
    const other = spaces.find((item) => item.id === route.activeSpaceId);
    if (other)
      void openSpaceWindow(other.id, other.id === preferredDefaultSpace(spaces)?.id).catch(
        () => undefined,
      );
    navigate(defaultSpaceRoute(fallback.id), { replace: true });
  }, [elsewhere, fallback, spaces, route.activeSpaceId, navigate]);
  useEffect(() => {
    if (!route.activeSpaceId) return;
    const base = `/spaces/${encodeURIComponent(route.activeSpaceId)}`;
    if (location.pathname === base) {
      navigate(`${base}/home${location.search}${location.hash}`, { replace: true });
    }
  }, [location.hash, location.pathname, location.search, navigate, route.activeSpaceId]);

  if (!user)
    return (
      <div className="grid h-full place-content-center gap-3 p-6 text-center">
        <h1 className="text-xl font-semibold">Sign in to use Spaces</h1>
        <p className="text-sm text-cream-muted">
          Collaborate on projects with chat, planning, and shared materials.
        </p>
        <Button onClick={() => openSignInSheet("space")}>Sign in</Button>
      </div>
    );

  if (!ready && error)
    return (
      <div className="grid h-full place-content-center gap-3 text-center text-sm text-cream-muted">
        <p role="alert">Spaces could not be loaded.</p>
        <Button onClick={() => void load({ force: true })}>Retry</Button>
      </div>
    );
  if (!ready || (elsewhere && hasTauriInternals()))
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-charcoal-workspace">
        <div className="flex h-11 shrink-0 items-center gap-3 border-b border-charcoal-border px-3">
          <Skeleton className="size-6 rounded-md" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-6 w-72" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col p-6">
          <CollectionSkeleton label="Spaces" view="grid" />
        </div>
      </div>
    );

  if (!route.activeSpaceId)
    return (
      <GlobalCreateSpaceDialog>
        {(create) => (
          <div className="grid h-full place-content-center gap-4 p-6 text-center">
            <h1 className="text-xl font-semibold">Your project Spaces</h1>
            <p className="text-sm text-cream-muted">
              Chat, plan, and keep project materials together.
            </p>
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
            {inviteError && <p role="alert">{inviteError}</p>}
            <Button onClick={create}>Create Space</Button>
          </div>
        )}
      </GlobalCreateSpaceDialog>
    );

  if (!space) return <p className="p-6 text-sm text-cream-muted">This Space is unavailable.</p>;
  return (
    <SpaceOverviewProvider accountId={user.id} space={space}>
      <ViewingSpace spaceId={space.id} onView={setViewingSpace} />
      <section
        className="relative flex h-full min-h-0 min-w-0 overflow-hidden bg-charcoal-bg"
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
      </section>
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
