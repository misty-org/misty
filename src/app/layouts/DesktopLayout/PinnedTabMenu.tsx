import { AudioLines, Pin, PinOff, RotateCcw, Star, StarOff } from "lucide-react";
import { publicBetaFeatureEnabled } from "@/features/launch";
import { captureTab } from "@/features/voice";
import { browserRuntimeId } from "@/features/browser";
import {
  addFavorite,
  isFavorite,
  removeFavorite,
  useFavorites,
} from "@/features/bookmarks/favorites";
import { dockTreeViews } from "@/features/workspace/dockTree";
import { activeLayoutView } from "@/features/workspace/layoutTabs";
import { useUserStore } from "@/features/auth/core";
import { pinnedTabsBlockedReason } from "@/features/browser-workspace/pinnedTabsGate";
import { useBrowserSyncStore } from "@/features/browser-workspace/store";
import { parseBrowserViewState, type WorkspaceTab } from "@/features/workspace/model";
import { pinnableTabUrl } from "@/features/workspace/pinnedTabs";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import { ContextMenuAction, ContextMenuLabel } from "@/shared/ui";
import { isIncognitoWindow } from "@/features/workspace/spaceWindow";

/** Pin and favorite actions for the page in a tab's right-click menu. */
export function TabPageMenu({ tab }: { tab: WorkspaceTab }) {
  return (
    <>
      <PinnedTabMenu tab={tab} />
      <FavoriteTabMenu tab={tab} />
      <TranscribeTabMenu tab={tab} />
    </>
  );
}

/** Pin and unpin in a tab's right-click menu. */
function PinnedTabMenu({ tab }: { tab: WorkspaceTab }) {
  // Synced workspaces keep pins only once every device understands them.
  const session = useBrowserSyncStore((state) => state.session);
  const ownerName = useUserStore((state) => state.me?.username);
  const blockedReason = pinnedTabsBlockedReason(session, ownerName);
  if (tab.pinnedUrl) {
    const view = activeLayoutView(tab);
    const current =
      view?.surfaceId === "browser" ? parseBrowserViewState(view.state).url : undefined;
    return (
      <>
        {current !== tab.pinnedUrl && (
          <ContextMenuAction
            label="Go back to pinned page"
            icon={<RotateCcw />}
            onSelect={() => useWorkspaceStore.getState().resetPinnedTab(tab.id)}
          />
        )}
        <ContextMenuAction
          label="Unpin tab"
          icon={<PinOff />}
          onSelect={() => useWorkspaceStore.getState().unpinTab(tab.id)}
        />
      </>
    );
  }
  if (!pinnableTabUrl(tab)) return null;
  return (
    <>
      <ContextMenuAction
        label="Pin tab"
        icon={<Pin />}
        disabled={Boolean(blockedReason)}
        onSelect={() => useWorkspaceStore.getState().pinTab(tab.id)}
      />
      {blockedReason ? (
        <ContextMenuLabel inset className="max-w-64 pt-0 font-normal">
          {blockedReason}
        </ContextMenuLabel>
      ) : null}
    </>
  );
}

/** Add the tab's page to Favorites, or remove the favorite it was opened from. */
function FavoriteTabMenu({ tab }: { tab: WorkspaceTab }) {
  const favorites = useFavorites();
  const views = dockTreeViews(tab.root);
  const view = views.length === 1 && views[0].surfaceId === "browser" ? views[0] : null;
  if (!view) return null;
  const state = parseBrowserViewState(view.state);
  if (isFavorite(favorites, state.bookmarkId))
    return (
      <ContextMenuAction
        label="Remove from favorites"
        icon={<StarOff />}
        onSelect={() => removeFavorite(state.bookmarkId!)}
      />
    );
  if (isIncognitoWindow() || state.agentOwned || !/^https?:/.test(state.url)) return null;
  return (
    <ContextMenuAction
      label="Add to favorites"
      icon={<Star />}
      onSelect={() => {
        const id = addFavorite(state.url, view.title);
        // The favorite now switches to this tab instead of opening another.
        useWorkspaceStore.getState().updateBrowserView(view.id, { bookmarkId: id });
      }}
    />
  );
}

/** "Transcribe this tab": hear the page's own audio into a live Note. */
function TranscribeTabMenu({ tab }: { tab: WorkspaceTab }) {
  if (!publicBetaFeatureEnabled("voiceNotes")) return null;
  const views = dockTreeViews(tab.root);
  const view = views.length === 1 && views[0].surfaceId === "browser" ? views[0] : null;
  if (!view) return null;
  const state = parseBrowserViewState(view.state);
  if (!/^https?:/.test(state.url)) return null;
  return (
    <ContextMenuAction
      label="Transcribe this tab"
      icon={<AudioLines />}
      onSelect={() => void captureTab(browserRuntimeId(view), view.title, state.url)}
    />
  );
}
