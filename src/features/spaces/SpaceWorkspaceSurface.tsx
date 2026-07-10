import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/features/auth";
import { useWorkspaceTabFocused } from "@/features/workspace/WorkspaceTabRouteScope";
import type { WorkspaceTab } from "@/features/workspace/core";
import { Button } from "@/shared/ui";
import { GlobalCreateSpaceDialog } from "./GlobalCreateSpaceDialog";
import { SpaceSectionView } from "./SpaceSectionView";
import { preferredDefaultSpace } from "./defaultSpace";
import { useSpacesStore } from "./store/useSpacesStore";
import { useSpacePanelRoute } from "./components/spacePanel/spacePanelRoute";
import { SpaceWorkspaceRail } from "./components/SpaceWorkspaceRail";
import { SpaceInvitationsNotice } from "./spacesShell/SpaceInvitationsNotice";
/** Each Space pane owns its navigation and content. */
export function SpaceWorkspaceSurface({ tab }: { tab: WorkspaceTab }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const focused = useWorkspaceTabFocused();
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
      navigate(`/spaces/${encodeURIComponent(fallback.id)}/social`, { replace: true });
    }
  }, [fallback, ready, route.activeSpaceId, navigate]);
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

  if (!ready)
    return (
      <div
        className="grid h-full place-content-center gap-3 text-center text-sm text-cream-muted"
        role="status"
      >
        <p>{error ? "Spaces could not be loaded." : "Loading Spaces…"}</p>
        {error && <Button onClick={() => void load({ force: true })}>Retry</Button>}
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

  return (
    <section
      className="@container relative flex h-full min-h-0 min-w-0 overflow-hidden bg-charcoal-bg"
      data-space-workspace={route.activeSpaceId}
      aria-label={`${space?.name ?? "Space"} workspace`}
    >
      <SpaceWorkspaceRail activeSpaceId={route.activeSpaceId} section={route.section} />
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <SpaceSectionView
          spaceId={route.activeSpaceId}
          section={route.section === "home" ? "social" : route.section}
          studioKind={route.section === "settings" ? route.settingsSection : route.drawingId}
          workspaceTabId={tab.id}
        />
      </div>
    </section>
  );
}
