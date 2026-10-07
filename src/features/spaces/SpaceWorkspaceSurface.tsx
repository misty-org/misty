import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/features/auth";
import { useWorkspaceViewFocused } from "@/features/workspace/WorkspaceViewRouteScope";
import type { WorkspaceView } from "@/features/workspace/core";
import { SpaceOverviewProvider } from "./useSpaceOverview";
import { Button, CollectionSkeleton, Skeleton } from "@/shared/ui";
import { GlobalCreateSpaceDialog } from "./GlobalCreateSpaceDialog";
import { SpaceSectionView } from "./SpaceSectionView";
import { preferredDefaultSpace } from "./defaultSpace";
import { defaultSpaceRoute } from "./store/useSpacesTabsStore";
import { useSpacesStore } from "./store/useSpacesStore";
import { useSpacePanelRoute } from "./components/spacePanel/spacePanelRoute";
import { SpacePageHeader } from "./components/SpacePageHeader";
import { SpaceInvitationsNotice } from "./spacesShell/SpaceInvitationsNotice";
/** Each Space pane owns its navigation and content. */
export function SpaceWorkspaceSurface({ tab }: { tab: WorkspaceView }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const focused = useWorkspaceViewFocused();
  const setViewingSpace = useSpacesStore((state) => state.setViewingSpace);
  const route = useSpacePanelRoute();
  const spaces = useSpacesStore((state) => state.spaces);
  const ready = useSpacesStore((state) => state.snapshotReady);
  const error = useSpacesStore((state) => state.error);
  const load = useSpacesStore((state) => state.load);
  const invitations = useSpacesStore((state) => state.invitations);
  const respondInvite = useSpacesStore((state) => state.respondInvite);
  const space = spaces.find((item) => item.id === route.activeSpaceId);
  const fallback = preferredDefaultSpace(spaces);
  const [inviteError, setInviteError] = useState("");
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
  useEffect(() => {
    if (!focused || !user || !space) return;
    setViewingSpace(space.id);
    return () => setViewingSpace("");
  }, [focused, user, space, setViewingSpace]);

  if (!user)
    return (
      <div className="grid h-full place-content-center gap-3 p-6 text-center">
        <h1 className="text-xl font-semibold">Sign in to use Spaces</h1>
        <p className="text-sm text-cream-muted">
          Collaborate on projects with chat, planning, and shared materials.
        </p>
        <Button onClick={() => navigate("/signin", { state: { from: tab.route } })}>Sign in</Button>
      </div>
    );

  if (!ready && error)
    return (
      <div className="grid h-full place-content-center gap-3 text-center text-sm text-cream-muted">
        <p role="alert">Spaces could not be loaded.</p>
        <Button onClick={() => void load({ force: true })}>Retry</Button>
      </div>
    );
  if (!ready)
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
      <section
        className="relative flex h-full min-h-0 min-w-0 overflow-hidden bg-charcoal-workspace"
        data-space-workspace={route.activeSpaceId}
        aria-label={`${space?.name ?? "Space"} workspace`}
      >
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <SpacePageHeader space={space} section={route.section} />
          <div className="min-h-0 flex-1 overflow-hidden">
            <SpaceSectionView
              spaceId={route.activeSpaceId}
              section={route.section}
              studioKind={route.section === "settings" ? route.settingsSection : route.drawingId}
              workspaceTabId={tab.id}
            />
          </div>
        </div>
      </section>
    </SpaceOverviewProvider>
  );
}
