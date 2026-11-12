import { openSignInSheet, useAuth } from "@/features/account";
import { EmptyState } from "@/shared/ui";
import { lazy, Suspense, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { SpacePageLoadingPlaceholder } from "../components/SpacePageLoadingPlaceholder";
import { useSpacesStore } from "../list/useSpacesStore";

const Notes = lazy(() =>
  import("@/features/spaces/journal/notes/SpaceNotes").then((m) => ({ default: m.SpaceNotes })),
);
const Drawings = lazy(() =>
  import("@/features/spaces/journal/drawings/SpaceDrawings").then((m) => ({
    default: m.SpaceDrawings,
  })),
);
async function loadLibrary() {
  const { SpaceLibrary } = await import("@/features/spaces/library/SpaceLibrary");
  return { default: SpaceLibrary };
}
const Library = lazy(loadLibrary);
async function loadChat() {
  const { SpaceChatEntry } = await import("../chat/SpaceChatEntry");
  return { default: SpaceChatEntry };
}
const Chat = lazy(loadChat);
const Planner = lazy(() =>
  import("@/features/spaces/planner/SpacePlanner").then((m) => ({ default: m.SpacePlanner })),
);
const Calendar = lazy(() =>
  import("@/features/spaces/calendar/SpaceCalendar").then((m) => ({ default: m.SpaceCalendar })),
);
async function loadHome() {
  const { SpaceHome } = await import("../home/SpaceHome");
  return { default: SpaceHome };
}
const Home = lazy(loadHome);

export async function preloadSpaceSection(section: string) {
  switch (section) {
    case "home":
      await loadHome();
      break;
    case "social":
    case "chat":
      await loadChat();
      break;
    case "notes":
      await import("@/features/spaces/journal/notes/SpaceNotes");
      break;
    case "drawings":
      await import("@/features/spaces/journal/drawings/SpaceDrawings");
      break;
    case "library":
      await loadLibrary();
      break;
      break;
    case "planner":
      await import("@/features/spaces/planner/SpacePlanner");
      break;
    case "calendar":
      await import("@/features/spaces/calendar/SpaceCalendar");
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
  const section = props.section || "home";
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
      <EmptyState
        title="Log in to view this Space"
        line="Sign in to your Misty account to open Spaces and see their content."
        action={{
          label: accounts.length > 0 ? "Switch account" : "Log in",
          onClick: () =>
            accounts.length > 0
              ? navigate("/signin", { state: { from: returnPath } })
              : openSignInSheet("space"),
        }}
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
        title="This Space isn’t available"
        line="This Space may have been removed, or you may no longer have access."
      />
    );
  }

  return (
    <div className="relative h-full min-h-0 overflow-hidden">
      <Suspense fallback={<SpacePageLoadingPlaceholder />}>
        {/* Notes and Drawings without an item show the Journal: the home's collection, narrowed. */}
        {section === "home" ||
        (section === "notes" && !new URLSearchParams(location.search).get("note")) ||
        (section === "drawings" && !studioKind) ||
        // There is no settings page: its links land on the home, and the Space menu has the rest.
        section === "settings" ? (
          <Home space={space} journal={section === "notes" || section === "drawings"} />
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
        ) : section === "planner" ? (
          <Planner spaceId={spaceId} />
        ) : section === "calendar" ? (
          <Calendar spaceId={spaceId} />
        ) : section === "social" || section === "chat" ? (
          <Chat spaceId={spaceId} spaceName={space.name} workspaceTabId={props.workspaceTabId} />
        ) : (
          <EmptyState
            title="This Space view isn’t available"
            line="Choose a Space tool from the sidebar."
          />
        )}
      </Suspense>
    </div>
  );
}
