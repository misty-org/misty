import {
  Armchair,
  Bot,
  FlaskConical,
  Plus,
  Search,
  Waypoints,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  openAgentsHub,
  useChatStatuses,
  useAgentAccountId,
  useChatSectionsStore,
  useLessonStore,
  useMistyStore,
  tutorChatIds,
  useTutorStore,
  watchSharedNotebooks,
  usePersonalAgentsStore,
} from "@/features/agents";
import { dockLeaves, useWorkspaceStore, type WorkspaceView } from "@/features/app-windows";
import { useWindowSpace } from "@/features/spaces";
import { cn, CustomizableBar, NavGroupHeading, NavRow, Skeleton, spaceIcons } from "@/shared/ui";
import { SidebarChats } from "./SidebarChats";
import { SidebarMore, type SidebarPlace } from "./SidebarPins";
import { SidebarRow as Row } from "./SidebarRow";
import { sidebarPinDefaults, useSidebarPins, type SidebarPlaceId } from "./sidebarPinsStore";
import { chatSectionClass, markSlotClass } from "./styles";
import { useSearchDialog } from "./search/searchStore";
import {
  agentChatRoute,
  openNewChat,
  openWorkspaceRoute,
  openWorkspaceRouteIn,
} from "./spaceNavigation";

/** The sidebar's places: search, the Agents window (picking and setting up agents and their
 * CLIs), the window's Space, the agents' studio, the person's Lab, and the integrations agents
 * can use. */
const placeNames: Record<SidebarPlaceId, { label: string; icon: LucideIcon }> = {
  search: { label: "Search", icon: Search },
  agents: { label: "Agents", icon: Bot },
  space: { label: "Space", icon: spaceIcons.space },
  studio: { label: "Studio", icon: Armchair },
  lab: { label: "Lab", icon: FlaskConical },
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

function RowSkeletons({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <NavRow key={index} still aria-hidden="true">
          <Skeleton className="size-4 rounded-md" />
          <Skeleton className="h-3 w-28" />
        </NavRow>
      ))}
    </>
  );
}

const chatTitleWidths = ["w-32", "w-24", "w-36", "w-28", "w-20", "w-32"];

/**
 * The chats on their very first read, in the list's own shape: one section with its group
 * heading, then chat rows with the agent's mark, a title and the time at the right end.
 */
function ChatSkeletons() {
  return (
    <section role="status" aria-label="Chats" aria-busy="true" className={chatSectionClass}>
      <NavGroupHeading aria-hidden="true">
        <Skeleton className="h-2.5 w-10 rounded-sm" />
      </NavGroupHeading>
      {chatTitleWidths.map((width, index) => (
        <NavRow key={index} still data-skeleton="" aria-hidden="true">
          <span className={markSlotClass}>
            <Skeleton className="size-4 rounded-sm" />
          </span>
          <Skeleton className={`h-3 ${width}`} />
          <Skeleton className="ml-auto h-2.5 w-6 shrink-0 rounded-sm" />
        </NavRow>
      ))}
    </section>
  );
}

/**
 * What the sidebar holds: a new chat, the places the person pinned and More for the rest, then
 * every chat the person has, newest first, each marked with its agent. A chat works in its own
 * Space, whichever the window shows. Lesson chats, and the chats Tutor's runs make, live under
 * Tutor instead. Each row opens in the focused pane.
 */
export function SpaceNavigator({ onOpen }: { onOpen(view: WorkspaceView): void }) {
  const accountId = useAgentAccountId();
  const space = useWindowSpace();
  const agents = usePersonalAgentsStore((state) => state.agents);
  const conversations = useMistyStore((state) => state.conversations);
  const conversationsLoading = useMistyStore((state) => state.conversationsLoading);
  // The account whose chats have been read once, so the skeleton covers only the first read: a
  // later reload keeps the list on screen.
  const [chatsReadFor, setChatsReadFor] = useState<string | null>(null);
  const lessons = useLessonStore((state) => state.lessons);
  const tutorJobs = useTutorStore((state) => state.jobs);
  const tutorNotebooks = useTutorStore((state) => state.notebooks);
  const route = useFocusedRoute();
  const statuses = useChatStatuses();
  useEffect(() => {
    void usePersonalAgentsStore.getState().load(accountId);
    void useLessonStore.getState().load(accountId);
    void useTutorStore.getState().load(accountId).then(watchSharedNotebooks);
    void useChatSectionsStore
      .getState()
      .load(accountId)
      .catch(() => undefined);
    const chats = useMistyStore.getState();
    chats.setAccount(accountId);
    void chats
      .loadConversations()
      .catch(() => undefined)
      .finally(() => setChatsReadFor(accountId));
  }, [accountId]);
  const chatsPending =
    !conversations.length && (conversationsLoading || chatsReadFor !== accountId);

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
  // Search and Agents open windows over the page, not pages of their own.
  type Page = Exclude<SidebarPlaceId, "search" | "agents">;
  const isPage = (id: SidebarPlaceId): id is Page => id !== "search" && id !== "agents";
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
        current: isPage(id) && current(id),
        open: () =>
          isPage(id)
            ? open(target(id))
            : id === "search"
              ? useSearchDialog.getState().setOpen(true)
              : openAgentsHub(),
      },
    ]),
  ) as Record<SidebarPlaceId, SidebarPlace>;
  const row = (id: SidebarPlaceId) => {
    const { label, icon: Icon, current: here, open: go } = places[id];
    return (
      <Row
        key={id}
        label={label}
        icon={<Icon aria-hidden="true" />}
        shortcut={id === "search" ? "Meta+K" : undefined}
        current={here}
        onOpen={go}
        data-tour={`sidebar-${id}`}
      />
    );
  };

  return (
    <>
      {/* A new chat and the Space's pages; the rows keep a visible gap, so a hovered row never
          runs into the current one. */}
      <nav
        className="mt-1.5 flex flex-none flex-col gap-1.5"
        aria-label="Space"
        data-misty-window-drag-block="true"
      >
        <Row
          label="New"
          icon={<Plus aria-hidden="true" />}
          onOpen={() => openNewChat(onOpen)}
          data-tour="sidebar-new"
        />
        {space ? (
          <>
            {/* The pinned places drag into the person's order; a right-click on them pins or
                unpins any place, and More keeps the rest. */}
            <CustomizableBar
              label="Places"
              axis="y"
              items={Object.fromEntries(
                order.map((id) => [id, { label: places[id].label, node: row(id) }]),
              )}
              layout={{ order, hidden: order.filter((id) => !pinned.includes(id)) }}
              onChange={(next) =>
                useSidebarPins.getState().set({
                  order: next.order as SidebarPlaceId[],
                  pinned: (next.order as SidebarPlaceId[]).filter(
                    (id) => !next.hidden.includes(id),
                  ),
                })
              }
              onReset={() => useSidebarPins.getState().set(sidebarPinDefaults)}
              className="items-stretch gap-1.5"
            />
            <SidebarMore places={places} />
          </>
        ) : (
          <RowSkeletons count={pinned.length + 1} />
        )}
      </nav>
      {/* The chats take the room that is left and scroll inside it. */}
      <nav
        className={cn(
          "mt-3.5 flex min-h-0 flex-1 flex-col gap-2.5 overflow-x-hidden overflow-y-auto",
          "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        )}
        aria-label="Chats"
        data-misty-window-drag-block="true"
      >
        {chatsPending ? (
          <ChatSkeletons />
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
