import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/features/auth";
import { useWorkspaceViewFocused } from "@/features/workspace/WorkspaceViewRouteScope";
import type { WorkspaceView } from "@/features/workspace/core";
import { Menu } from "lucide-react";
import { SpaceOverviewProvider } from "./useSpaceOverview";
import {
  Button,
  IconButton,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/shared/ui";
import { GlobalCreateSpaceDialog } from "./GlobalCreateSpaceDialog";
import { SpaceSectionView } from "./SpaceSectionView";
import { preferredDefaultSpace } from "./defaultSpace";
import { useSpacesStore } from "./store/useSpacesStore";
import { useSpacePanelRoute } from "./components/spacePanel/spacePanelRoute";
import { SpaceWorkspaceRail } from "./components/SpaceWorkspaceRail";
import { SpaceInvitationsNotice } from "./spacesShell/SpaceInvitationsNotice";
/** Each Space pane owns its navigation and content. */
export function SpaceWorkspaceSurface({ tab }: { tab: WorkspaceView }) {
  const { user } = useAuth();
  const navigate = useNavigate();
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
  const hostRef = useRef<HTMLElement>(null);
  const [narrow, setNarrow] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => setNarrow(entries[0].contentRect.width < 760));
    observer.observe(host);
    return () => observer.disconnect();
  }, [ready, space?.id, user?.id]);
  const [inviteError, setInviteError] = useState("");
  useEffect(() => {
    if (!route.activeSpaceId && ready && fallback) {
      navigate(`/spaces/${encodeURIComponent(fallback.id)}/home`, { replace: true });
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

  if (!space) return <p className="p-6 text-sm text-cream-muted">This Space is unavailable.</p>;
  return (
    <SpaceOverviewProvider accountId={user.id} space={space}>
      <section
        ref={hostRef}
        className="relative flex h-full min-h-0 min-w-0 overflow-hidden bg-charcoal-workspace"
        data-space-workspace={route.activeSpaceId}
        aria-label={`${space?.name ?? "Space"} workspace`}
      >
        {!narrow && (
          <div className="h-full shrink-0">
            <SpaceWorkspaceRail activeSpaceId={route.activeSpaceId} section={route.section} />
          </div>
        )}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {narrow && (
            <div className="flex h-10 shrink-0 items-center gap-2 border-b border-charcoal-border px-2">
              <Sheet open={navOpen} onOpenChange={setNavOpen}>
                <SheetTrigger asChild>
                  <IconButton label="Open Space navigation">
                    <Menu />
                  </IconButton>
                </SheetTrigger>
                <SheetContent side="left" className="w-[min(300px,90vw)] p-0 pt-10">
                  <SheetTitle className="sr-only">Space navigation</SheetTitle>
                  <SheetDescription className="sr-only">
                    Browse this Space and your recent items.
                  </SheetDescription>
                  <SpaceWorkspaceRail
                    activeSpaceId={space.id}
                    section={route.section}
                    onNavigated={() => setNavOpen(false)}
                  />
                </SheetContent>
              </Sheet>
              <span className="truncate text-sm">{space.name}</span>
            </div>
          )}
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
