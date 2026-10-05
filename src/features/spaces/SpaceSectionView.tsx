import { useAuth } from "@/features/auth";
import { Button, EmptyState, PermissionState } from "@/shared/ui";
import { lazy, Suspense, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { SpaceSettings } from "./components/SpaceSettings";
import { SpacePageLoadingPlaceholder } from "./components/SpacesLoadingPlaceholder";
import { useSpacesStore } from "./store/useSpacesStore";

const Notes = lazy(() =>
  import("@/features/journal/notes/SpaceNotes").then((m) => ({ default: m.SpaceNotes })),
);
const Drawings = lazy(() =>
  import("@/features/journal/drawings/SpaceDrawings").then((m) => ({ default: m.SpaceDrawings })),
);
// Configure host services before React renders the built-in tools.
// Their runtime hooks deliberately fail if an entry point skips this setup.
async function loadLibrary() {
  const { initializeHostLibraryRuntime } =
    await import("@/features/library/library/hostLibraryRuntime");
  initializeHostLibraryRuntime();
  const { SpaceLibrary } = await import("@/features/library/library/SpaceLibrary");
  return { default: SpaceLibrary };
}
const Library = lazy(loadLibrary);
async function loadChat() {
  const { initializeHostSocialRuntime } = await import("./chat/hostSocialRuntime");
  initializeHostSocialRuntime();
  const { SpaceChatEntry } = await import("./chat/SpaceChatEntry");
  return { default: SpaceChatEntry };
}
const Chat = lazy(loadChat);
const Code = lazy(() => import("./code/SpaceCode").then((m) => ({ default: m.SpaceCode })));

export async function preloadSpaceSection(section: string) {
  switch (section) {
    case "social":
    case "chat":
      await loadChat();
      break;
    case "notes":
      await import("@/features/journal/notes/SpaceNotes");
      break;
    case "drawings":
      await import("@/features/journal/drawings/SpaceDrawings");
      break;
    case "library":
      await loadLibrary();
      break;
    case "code":
      await import("./code/SpaceCode");
      break;
  }
}

/**
 * One Space section, rendered from props rather than the router.
 *
 * The dock can show the same Space in several panes at once, and there is only
 * one router URL — so pane content cannot come from the outlet. Everything
 * here is therefore driven by `spaceId`/`section`, and nothing in it navigates
 * on its own: a background pane that issued redirects would move the whole app
 * out from under the focused one. Route normalisation stays in `SpaceDetail`.
 */
export function SpaceSectionView(props: {
  spaceId: string;
  section: string;
  studioKind?: string;
  workspaceTabId?: string;
}) {
  const { spaceId, studioKind = "" } = props;
  const section = props.section === "home" ? "social" : props.section;
  const { user, accounts, transitioning } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { spaces, snapshotReady, loading, error, load, loadSpace } = useSpacesStore(
    useShallow((state) => ({
      spaces: state.spaces,
      snapshotReady: state.snapshotReady,
      loading: state.loading,
      error: state.error,
      load: state.load,
      loadSpace: state.loadSpace,
    })),
  );
  const space = spaces.find((item) => item.id === spaceId);

  useEffect(() => {
    if (spaceId && user) void loadSpace(spaceId);
  }, [loadSpace, spaceId, user]);

  if (transitioning) return <SpacePageLoadingPlaceholder label="Switching accounts" />;

  if (!user) {
    const returnPath = `${location.pathname}${location.search}${location.hash}`;
    return (
      <PermissionState
        className="h-full"
        title="Log in to view this Space"
        description="Sign in to your Misty account to open Spaces and see their content."
        action={
          <Button
            type="button"
            onClick={() => navigate("/signin", { state: { from: returnPath } })}
          >
            {accounts.length > 0 ? "Switch account" : "Log in"}
          </Button>
        }
      />
    );
  }

  if (!snapshotReady && error) {
    return (
      <SpacePageLoadingPlaceholder
        label="Loading Space"
        onRetry={() => {
          void load({ force: true }).then(() => {
            if (useSpacesStore.getState().snapshotReady) void loadSpace(spaceId);
          });
        }}
      />
    );
  }

  if (!snapshotReady || (!space && loading)) return <SpacePageLoadingPlaceholder />;

  if (!space) {
    return (
      <EmptyState
        className="h-full"
        title="This Space isn’t available"
        description="This Space may have been removed, or you may no longer have access."
      />
    );
  }

  return (
    <div className="relative h-full min-h-0 overflow-hidden">
      <Suspense fallback={<SpacePageLoadingPlaceholder />}>
        {section === "settings" ? (
          <SpaceSettings
            key={`settings:${spaceId}:${studioKind}`}
            spaceId={spaceId}
            section={studioKind}
          />
        ) : section === "notes" ? (
          <Notes spaceId={spaceId} spaceName={space.name} workspaceTabId={props.workspaceTabId} />
        ) : section === "drawings" ? (
          <Drawings
            spaceId={spaceId}
            drawingId={studioKind}
            workspaceTabId={props.workspaceTabId}
          />
        ) : section === "library" ? (
          <Library spaceId={spaceId} workspaceTabId={props.workspaceTabId} />
        ) : section === "code" ? (
          <Code spaceId={spaceId} workspaceTabId={props.workspaceTabId} />
        ) : section === "social" || section === "chat" ? (
          <Chat spaceId={spaceId} spaceName={space.name} workspaceTabId={props.workspaceTabId} />
        ) : (
          <EmptyState
            className="h-full"
            title="This Space view isn’t available"
            description="Choose a Space tool from the sidebar."
          />
        )}
      </Suspense>
    </div>
  );
}
