import { useAuth } from "@/features/account";
import { useWorkspaceViewTitle } from "@/features/app-windows";
import { EmptyState, spaceKindsWithItemPath, spaceMadeKindForSection } from "@/shared/ui";
import { lazy, Suspense, useEffect } from "react";
import { useLocation } from "react-router-dom";
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
async function loadSlides() {
  const { SpaceSlides } = await import("@/features/spaces/slides/SpaceSlides");
  return { default: SpaceSlides };
}
const Slides = lazy(loadSlides);
async function loadData() {
  const { SpaceData } = await import("@/features/spaces/data/SpaceData");
  return { default: SpaceData };
}
const Data = lazy(loadData);
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
async function loadLab() {
  const { SpaceLab } = await import("@/features/agents");
  return { default: SpaceLab };
}
const Lab = lazy(loadLab);
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
    case "slides":
      await loadSlides();
      break;
    case "data":
      await loadData();
      break;
    case "media":
      await loadLibrary();
      break;
    case "planner":
      await import("@/features/spaces/planner/SpacePlanner");
      break;
    case "calendar":
      await import("@/features/spaces/calendar/SpaceCalendar");
      break;
    case "lab":
      await loadLab();
      break;
  }
}

/** The tab's name for the pages that don't name it themselves (Docs, Slides, Data, Whiteboards,
 * Library and Chat do), so a tab that moves to one of them never keeps the last page's name. */
const sectionTabTitles: Record<string, string> = {
  home: "Space",
  settings: "Space",
  planner: "Planner",
  calendar: "Calendar",
  lab: "Lab",
};

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
  /** The whiteboard, deck or workbook open on its page. */
  itemId?: string;
  workspaceTabId?: string;
}) {
  const { spaceId, itemId = "" } = props;
  const section = props.section || "home";
  const { user, transitioning } = useAuth();
  const location = useLocation();
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
  useWorkspaceViewTitle(props.workspaceTabId, sectionTabTitles[section] ?? "");

  // Switching accounts isn't a read of this page: it says so in words until the new account opens.
  if (transitioning) return <SpacePageLoadingPlaceholder label="Switching accounts" />;

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

  // The page this opens, for its first-load skeleton.
  const shape = {
    section,
    item:
      (section === "notes" && Boolean(new URLSearchParams(location.search).get("note"))) ||
      (spaceKindsWithItemPath.has(section) && Boolean(itemId)),
  };
  // The Space itself is read for the first time: the page it opens, in that page's shape.
  if (!snapshotReady || (!space && loading)) return <SpacePageLoadingPlaceholder shape={shape} />;

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
      {/* The page's code is on its way just ahead of its data: the page's own first-load
          skeleton holds its place, so it never flashes blank. */}
      <Suspense fallback={<SpacePageLoadingPlaceholder shape={shape} />}>
        {/* Docs, Slides, Data and Whiteboards without an item show their page: the home's
            collection, narrowed to that kind. */}
        {section === "home" ||
        (section === "notes" && !new URLSearchParams(location.search).get("note")) ||
        (spaceKindsWithItemPath.has(section) && !itemId) ||
        // There is no settings page: its links land on the home, and the Space menu has the rest.
        section === "settings" ? (
          <Home space={space} page={spaceMadeKindForSection(section)?.kind} />
        ) : section === "notes" ? (
          <Notes spaceId={spaceId} spaceName={space.name} workspaceTabId={props.workspaceTabId} />
        ) : section === "drawings" ? (
          <Drawings spaceId={spaceId} drawingId={itemId} workspaceTabId={props.workspaceTabId} />
        ) : section === "slides" ? (
          <Slides spaceId={spaceId} deckId={itemId} workspaceTabId={props.workspaceTabId} />
        ) : section === "data" ? (
          <Data spaceId={spaceId} workbookId={itemId} workspaceTabId={props.workspaceTabId} />
        ) : section === "media" ? (
          <Library spaceId={spaceId} workspaceTabId={props.workspaceTabId} />
        ) : section === "planner" ? (
          <Planner spaceId={spaceId} />
        ) : section === "calendar" ? (
          <Calendar spaceId={spaceId} />
        ) : section === "lab" ? (
          <Lab spaceId={spaceId} />
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
