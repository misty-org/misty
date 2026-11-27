import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/features/account";
import { useWorkspaceViewFocused } from "@/features/app-windows";
import type { WorkspaceView } from "@/features/app-windows/core";
import { Button, EmptyState, Surface, Text, useNotice } from "@misty/ui";
import { GlobalCreateSpaceDialog } from "../create/GlobalCreateSpaceDialog";
import { SpaceSectionView } from "./SpaceSectionView";
import { preferredDefaultSpace, windowSpace } from "../routes/default_space";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { defaultSpaceRoute } from "../routes/default_space_route";
import { useSpacesStore } from "../list/use_spaces_store";
import { renamedSectionPath, useSpaceRoute } from "../routes/space_route";
import { SpacePageLoadingPlaceholder } from "../components/SpacePageLoadingPlaceholder";
import { SpacePageShortcuts } from "../components/SpacePageShortcuts";
import { SpaceInvitationsNotice } from "../create/SpaceInvitationsNotice";
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
  const fallback = hasTauriInternals() ? windowSpace(spaces) : preferredDefaultSpace(spaces);
  const [inviteError, setInviteError] = useState("");
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
    const renamed = renamedSectionPath(location.pathname);
    if (renamed) navigate(`${renamed}${location.search}${location.hash}`, { replace: true });
  }, [location.hash, location.pathname, location.search, navigate, route.activeSpaceId]);

  if (!user) return null;

  if (!ready)
    return (
      <Surface tone="page" className="flex h-full min-h-0 flex-col overflow-hidden">
        {error ? (
          <SpacePageLoadingPlaceholder onRetry={() => void load({ force: true })} />
        ) : (
          <SpacePageLoadingPlaceholder shape={{ section: route.section || "home" }} />
        )}
      </Surface>
    );

  if (!route.activeSpaceId)
    return (
      <GlobalCreateSpaceDialog>
        {(create) => (
          <div className="grid h-full place-content-center gap-4 p-6 text-center">
            <Text as="h1" size="display" tone="bright" weight="semibold" wrap className="m-0">
              Your project Spaces
            </Text>
            <Text as="p" size="page" tone="muted" wrap className="m-0">
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
            <Button variant="primary" size="lg" onClick={create}>
              Create Space
            </Button>
          </div>
        )}
      </GlobalCreateSpaceDialog>
    );

  if (!space) return <EmptyState title="This Space is unavailable" />;
  return (
    <>
      <ViewingSpace spaceId={space.id} onView={setViewingSpace} />
      <section
        className="relative flex h-full min-h-0 min-w-0 overflow-hidden"
        data-space-workspace={route.activeSpaceId}
        aria-label={`${space?.name ?? "Space"} workspace`}
      >
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <SpacePageShortcuts space={space} />
          <div className="min-h-0 flex-1 overflow-hidden">
            <SpaceSectionView
              spaceId={route.activeSpaceId}
              section={route.section}
              itemId={route.itemId}
              workspaceTabId={tab.id}
            />
          </div>
        </div>
      </section>
    </>
  );
}

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
