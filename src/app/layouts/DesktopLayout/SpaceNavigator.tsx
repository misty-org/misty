import {
  Armchair,
  GraduationCap,
  House,
  Plus,
  Search,
  Waypoints,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo } from "react";
import { useAuth } from "@/features/account";
import {
  useChatStatuses,
  useAgentAccountId,
  useChatSectionsStore,
  useLessonStore,
  useMistyStore,
  tutorChatIds,
  useTutorStore,
  usePersonalAgentsStore,
} from "@/features/agents";
import { dockLeaves, useWorkspaceStore, type WorkspaceView } from "@/features/app-windows";
import { useWindowSpace } from "@/features/spaces";
import { Skeleton } from "@/shared/ui";
import { SidebarChats } from "./SidebarChats";
import { SidebarMore, type SidebarPlace } from "./SidebarPins";
import { SidebarRow as Row } from "./SidebarRow";
import { useSidebarPins, type SidebarPlaceId } from "./sidebarPinsStore";
import { useSearchDialog } from "./search/searchStore";
import {
  agentChatRoute,
  openNewChat,
  openWorkspaceRoute,
  openWorkspaceRouteIn,
} from "./spaceNavigation";

/** The sidebar's places: search, the window's Space, the agents' studio and
 * tutor, and the integrations agents can use. */
const placeNames: Record<SidebarPlaceId, { label: string; icon: LucideIcon }> = {
  search: { label: "Search", icon: Search },
  space: { label: "Space", icon: House },
  studio: { label: "Studio", icon: Armchair },
  tutor: { label: "Tutor", icon: GraduationCap },
  integrations: { label: "Integrations", icon: Waypoints },
};

/** The route of the page the person is looking at: the focused pane's open view. */
function useFocusedRoute(): string {
  return useWorkspaceStore((state) => {
    const pane = dockLeaves(state.layout.root).find(
      (leaf) => leaf.id === state.layout.focusedPaneId,
    );
    return pane?.views.find((view) => view.id === pane.activeViewId)?.route ?? "";
  });
}

function RowSkeletons({ count, icon = true }: { count: number; icon?: boolean }) {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="misty-space-nav-row" aria-hidden="true">
          {icon ? <Skeleton className="size-4 rounded-md" /> : null}
          <Skeleton className="h-3 w-28" />
        </div>
      ))}
    </>
  );
}

/**
 * What the sidebar holds: a new chat, the places the person pinned and More for the rest, then
 * every chat the person has, newest first, each marked with its agent. A chat works in its own
 * Space, whichever the window shows. Lesson chats, and the chats Tutor's runs make, live under
 * Tutor instead. Each row opens in the focused pane.
 */
export function SpaceNavigator({ onOpen }: { onOpen(view: WorkspaceView): void }) {
  const { user, sessionExpired } = useAuth();
  const signedIn = Boolean(user) && !sessionExpired;
  const accountId = useAgentAccountId();
  const space = useWindowSpace();
  const agents = usePersonalAgentsStore((state) => state.agents);
  const agentsLoading = usePersonalAgentsStore((state) => state.loading);
  const conversations = useMistyStore((state) => state.conversations);
  const lessons = useLessonStore((state) => state.lessons);
  const tutorJobs = useTutorStore((state) => state.jobs);
  const tutorNotebooks = useTutorStore((state) => state.notebooks);
  const route = useFocusedRoute();
  const statuses = useChatStatuses();
  useEffect(() => {
    void usePersonalAgentsStore.getState().load(accountId);
    void useLessonStore.getState().load(accountId);
    void useTutorStore.getState().load(accountId);
    void useChatSectionsStore
      .getState()
      .load(accountId)
      .catch(() => undefined);
    const chats = useMistyStore.getState();
    chats.setAccount(accountId);
    void chats.loadConversations().catch(() => undefined);
  }, [accountId]);

  const chats = useMemo(() => {
    const made = tutorChatIds(tutorJobs, tutorNotebooks);
    return conversations
      .filter((chat) => chat.messages.length > 0 && !lessons[chat.id] && !made.has(chat.id))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [conversations, lessons, tutorJobs, tutorNotebooks]);
  const agentOf = (agentId?: string) =>
    agents.find((agent) => agent.id === agentId) ??
    (agentId ? undefined : agents.find((agent) => agent.system_managed));
  const [path, query = ""] = route.split("?");
  const params = new URLSearchParams(query);
  const view = path === "/agents" ? params.get("view") : null;
  const openChat = path === "/agents" && !view ? params.get("conversation") : null;
  const base = space ? `/spaces/${encodeURIComponent(space.id)}` : "";
  const open = (target: string) => openWorkspaceRoute(target, onOpen);
  type Page = Exclude<SidebarPlaceId, "search">;
  const current = (id: Page) =>
    id === "space" ? Boolean(base) && (path === base || path.startsWith(`${base}/`)) : view === id;
  const target = (id: Page) => (id === "space" ? base : `/agents?view=${id}`);
  const order = useSidebarPins((state) => state.order);
  const pinned = useSidebarPins((state) => state.pinned);
  useEffect(() => void useSidebarPins.getState().load(), []);
  const places = Object.fromEntries(
    order.map((id) => [
      id,
      {
        ...placeNames[id],
        current: id !== "search" && current(id),
        open: () => (id === "search" ? useSearchDialog.getState().setOpen(true) : open(target(id))),
      },
    ]),
  ) as Record<SidebarPlaceId, SidebarPlace>;
  const row = (id: SidebarPlaceId) => {
    const { label, icon: Icon, current: here, open: go } = places[id];
    return (
      <Row
        key={id}
        label={label}
        icon={<Icon className="size-4" aria-hidden="true" />}
        shortcut={id === "search" ? "Meta+K" : undefined}
        current={here}
        onOpen={go}
      />
    );
  };

  return (
    <>
      <nav className="misty-space-nav" aria-label="Space" data-misty-window-drag-block="true">
        <Row
          label="New chat"
          icon={<Plus className="size-4" aria-hidden="true" />}
          onOpen={() => openNewChat(onOpen)}
        />
        {!signedIn ? (
          row("search")
        ) : space ? (
          <>
            {pinned.map(row)}
            <SidebarMore places={places} />
          </>
        ) : (
          <RowSkeletons count={pinned.length + 1} />
        )}
      </nav>
      <nav className="misty-space-chats" aria-label="Chats" data-misty-window-drag-block="true">
        {agentsLoading && !agents.length ? (
          <RowSkeletons count={4} icon={false} />
        ) : (
          // With no chats yet, the list still shows its "Chats" heading.
          <SidebarChats
            chats={chats}
            agentOf={agentOf}
            statuses={statuses}
            openChat={openChat}
            onOpen={(agent, chatId) => open(agentChatRoute(agent.id, chatId))}
            onOpenIn={(agent, chatId, place) =>
              openWorkspaceRouteIn(agentChatRoute(agent.id, chatId), place, onOpen)
            }
            onOpenGone={() => openNewChat(onOpen)}
          />
        )}
      </nav>
    </>
  );
}
