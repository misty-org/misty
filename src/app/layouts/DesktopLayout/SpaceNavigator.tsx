import { CodeXml, Plus, Search, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useChatStatuses,
  useAgentAccountId,
  useChatSectionsStore,
  useLessonStore,
  useMistyStore,
  tutorChatIds,
  useTutorStore,
  usePersonalAgentsStore,
  useProjectChats,
} from "@/features/agents";
import { dockLeaves, useWorkspaceStore, type WorkspaceView } from "@/features/app-windows";
import { useWindowSpace } from "@/features/spaces";
import {
  cn,
  CustomizableBar,
  ErrorState,
  NavGroupHeading,
  NavRow,
  Skeleton,
  spaceIcons,
} from "@/shared/ui";
import { SidebarChats } from "./SidebarChats";
import { SidebarMore, type SidebarPlace } from "./SidebarPins";
import { SidebarRow as Row } from "./SidebarRow";
import {
  sidebarPinDefaults,
  spacePageSections,
  useSidebarPins,
  type SidebarPlaceId,
} from "./sidebarPinsStore";
import { chatSectionClass, markSlotClass } from "./styles";
import { useSearchDialog } from "./search/searchStore";
import {
  agentChatRoute,
  openNewChat,
  openWorkspaceRoute,
  openWorkspaceRouteIn,
} from "./spaceNavigation";

/** The sidebar's places, Misty's main ones: search, the window's Space and Code, the editor for
 * the Space's folder. Agents are set up in Settings. */
const placeNames: Record<SidebarPlaceId, { label: string; icon: LucideIcon }> = {
  search: { label: "Search", icon: Search },
  space: { label: "Space", icon: spaceIcons.space },
  code: { label: "Code", icon: CodeXml },
  chat: { label: "Space chat", icon: spaceIcons.chat },
  docs: { label: "Docs", icon: spaceIcons.docs },
  slides: { label: "Slides", icon: spaceIcons.slides },
  data: { label: "Data", icon: spaceIcons.data },
  whiteboards: { label: "Whiteboards", icon: spaceIcons.whiteboards },
  lab: { label: "Lab", icon: spaceIcons.lab },
  planner: { label: "Planner", icon: spaceIcons.planner },
  calendar: { label: "Calendar", icon: spaceIcons.calendar },
  media: { label: "Media", icon: spaceIcons.media },
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
  const conversationsError = useMistyStore((state) => state.conversationsError);
  // The account whose chats have been read once, so the skeleton covers only the first read: a
  // later reload keeps the list on screen.
  const [chatsReadFor, setChatsReadFor] = useState<string | null>(null);
  const lessons = useLessonStore((state) => state.lessons);
  const tutorJobs = useTutorStore((state) => state.jobs);
  const tutorNotebooks = useTutorStore((state) => state.notebooks);
  const route = useFocusedRoute();
  const statuses = useChatStatuses();
  // Chats that work in a project are Code's: the Code page lists them, by project.
  const projectChats = useProjectChats();
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
    void chats
      .loadConversations()
      .catch(() => undefined)
      .finally(() => setChatsReadFor(accountId));
  }, [accountId]);
  const chatsPending =
    (!conversations.length && (conversationsLoading || chatsReadFor !== accountId)) ||
    projectChats === null;

  const chats = useMemo(() => {
    const made = tutorChatIds(tutorJobs, tutorNotebooks);
    return (
      conversations
        // Studio talks are the studio's own, never listed with the chats.
        .filter(
          (chat) =>
            chat.messages.length > 0 &&
            chat.place !== "studio" &&
            !projectChats?.[chat.id] &&
            !lessons[chat.id] &&
            !made.has(chat.id),
        )
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    );
  }, [conversations, projectChats, lessons, tutorJobs, tutorNotebooks]);
  // Stable while the agents are, so the sidebar groups chats by agent only when something changed.
  const agentOf = useCallback(
    (agentId?: string) =>
      agents.find((agent) => agent.id === agentId) ??
      (agentId ? undefined : agents.find((agent) => agent.system_managed)),
    [agents],
  );
  const [path, query = ""] = route.split("?");
  const params = new URLSearchParams(query);
  const view = path === "/agents" ? params.get("view") : null;
  const openChat = path === "/agents" && !view ? params.get("conversation") : null;
  const base = space ? `/spaces/${encodeURIComponent(space.id)}` : "";
  const open = (target: string) => openWorkspaceRoute(target, onOpen);
  // Search opens a window over the page, not a page of its own.
  type Page = Exclude<SidebarPlaceId, "search">;
  const isPage = (id: SidebarPlaceId): id is Page => id !== "search";
  const current = (id: Page) => {
    const section = spacePageSections[id];
    if (section) return Boolean(base) && path.startsWith(`${base}/${section}`);
    if (id !== "space") return view === id;
    // The Space's row is lit for its pages that have no row of their own pinned.
    const pinnedPage = Object.entries(spacePageSections).some(
      ([place, page]) =>
        pinned.includes(place as SidebarPlaceId) && path.startsWith(`${base}/${page}`),
    );
    return Boolean(base) && (path === base || path.startsWith(`${base}/`)) && !pinnedPage;
  };
  const target = (id: Page) => {
    const section = spacePageSections[id];
    if (section) return `${base}/${section}`;
    return id === "space" ? base : `/agents?view=${id}`;
  };
  const order = useSidebarPins((state) => state.order);
  const pinned = useSidebarPins((state) => state.pinned);
  useEffect(() => void useSidebarPins.getState().load(), []);
  const places = Object.fromEntries(
    order.map((id) => [
      id,
      {
        ...placeNames[id],
        current: isPage(id) && current(id),
        open: () => (isPage(id) ? open(target(id)) : useSearchDialog.getState().setOpen(true)),
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
        {conversationsError && !conversations.length ? (
          // The reads go on behind this; the first that works brings the list.
          <ErrorState
            inline
            title="Chats couldn't load"
            line={conversationsError}
            action={{
              label: "Try again",
              variant: "secondary",
              onClick: () => void useMistyStore.getState().loadConversations(),
            }}
          />
        ) : chatsPending ? (
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
            dragRoute={(agent, chatId) => agentChatRoute(agent.id, chatId)}
            onOpenGone={() => openNewChat(onOpen)}
          />
        )}
      </nav>
    </>
  );
}
