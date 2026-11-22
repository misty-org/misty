import { useAuth } from "@/features/account";
import { useWorkspaceViewTitle } from "@/features/app-windows";
import { EmptyState } from "@misty/ui";
import { lazy, Suspense, useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { SpacePageLoadingPlaceholder } from "../components/SpacePageLoadingPlaceholder";
import { voiceChannelPage } from "../apps/appCalls";
import { useSpacesStore } from "../list/useSpacesStore";

async function loadFiles() {
  const { FilesPage } = await import("../file-manager/FilesPage");
  return { default: FilesPage };
}
const Files = lazy(loadFiles);
async function loadChat() {
  const { SpaceChatEntry } = await import("../chat/SpaceChatEntry");
  return { default: SpaceChatEntry };
}
const Chat = lazy(loadChat);
async function loadExplore() {
  const { ExplorePage } = await import("@/features/agents");
  return { default: ExplorePage };
}
const Explore = lazy(loadExplore);
async function loadApp() {
  const { SpaceAppPage } = await import("../apps/SpaceAppPage");
  return { default: SpaceAppPage };
}
const App = lazy(loadApp);
// The calls feature sits above Spaces, so it hands its page in at startup.
async function loadVoice() {
  return { default: voiceChannelPage.get() };
}
const Voice = lazy(loadVoice);

export async function preloadSpaceSection(section: string) {
  switch (section) {
    case "home":
    case "settings":
    case "social":
    case "chat":
      await loadChat();
      break;
    case "files":
      await loadFiles();
      break;
    case "agents":
    case "explore":
      await loadExplore();
      break;
    case "app":
      await loadApp();
      break;
    case "voice":
      await loadVoice();
      break;
  }
}

/** The tab's name for the pages that don't name it themselves (Files and Chat do), so a tab
 * that moves to one of them never keeps the last page's name. */
const sectionTabTitles: Record<string, string> = {
  explore: "Explore",
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
  /** The app open on its page (`/app/<id>`), or the voice channel (`/voice/<id>`). */
  itemId?: string;
  workspaceTabId?: string;
}) {
  const { spaceId, itemId = "" } = props;
  const section = props.section || "home";
  const { user, transitioning } = useAuth();
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
  const shape = { section };
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
        {section === "files" ? (
          <Files />
        ) : section === "explore" ? (
          <Explore
            spaceId={spaceId}
            canManageApps={Boolean(space.permissions?.includes("apps.manage"))}
          />
        ) : section === "app" ? (
          <App space={space} appId={itemId} workspaceTabId={props.workspaceTabId} />
        ) : section === "voice" ? (
          <Voice spaceId={spaceId} channelId={itemId} workspaceTabId={props.workspaceTabId} />
        ) : // A Space has no home page: its address, and the old settings links, open its chat.
        section === "home" ||
          section === "settings" ||
          section === "social" ||
          section === "chat" ? (
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
