import { useAuth } from "@/features/account";
import { useWorkspaceViewTitle } from "@/features/app-windows";
import { EmptyState } from "@misty/ui";
import { lazy, Suspense, useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { SpacePageLoadingPlaceholder } from "../components/SpacePageLoadingPlaceholder";
import { voiceChannelPage } from "../apps/app_calls";
import { LazyFilesPage } from "../file-manager/LazyFilesPage";
import { useSpacesStore } from "../list/use_spaces_store";

async function loadChat() {
  const { SpaceChatEntry } = await import("../chat/SpaceChatEntry");
  return { default: SpaceChatEntry };
}
const Chat = lazy(loadChat);
async function loadExplore() {
  const { loadExplorePage } = await import("@/features/agents");
  const { ExplorePage } = await loadExplorePage();
  return { default: ExplorePage };
}
const Explore = lazy(loadExplore);
async function loadApp() {
  const { SpaceAppPage } = await import("../apps/SpaceAppPage");
  return { default: SpaceAppPage };
}
const App = lazy(loadApp);
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

const sectionTabTitles: Record<string, string> = {
  explore: "Explore",
};

export function SpaceSectionView(props: {
  spaceId: string;
  section: string;
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

  const shape = { section };
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
      <Suspense fallback={<SpacePageLoadingPlaceholder shape={shape} />}>
        {section === "files" ? (
          <LazyFilesPage />
        ) : section === "explore" ? (
          <Explore spaceId={spaceId} />
        ) : section === "app" ? (
          <App space={space} appId={itemId} workspaceTabId={props.workspaceTabId} />
        ) : section === "voice" ? (
          <Voice spaceId={spaceId} channelId={itemId} workspaceTabId={props.workspaceTabId} />
        ) : section === "home" ||
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
