import { Hash, House, Search, Users } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
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
  useProjectChats,
} from "@/features/agents";
import { dockLeaves, useWorkspaceStore, type WorkspaceView } from "@/features/app-windows";
import type { Space } from "@/features/spaces";
import {
  conversationName,
  conversationPath,
  groupConversations,
  isGroupDirectMessage,
  SpaceSelector,
  useSpaceConversations,
  useWindowSpace,
} from "@/features/spaces";
import {
  ErrorState,
  NavGroupHeading,
  NavRow,
  NavRowLabel,
  Skeleton,
  spaceIcons,
  Text,
} from "@misty/ui";
import { toggleSection, useCollapsedSections } from "./collapsedSections";
import { SidebarAgentThreads } from "./SidebarAgentThreads";
import { SidebarRow as Row } from "./SidebarRow";
import { chatSectionClass, markSlotClass } from "./styles";
import { useSearchDialog } from "./search/searchStore";
import { agentChatRoute, openWorkspaceRoute } from "./spaceNavigation";

const ExploreIcon = spaceIcons.explore;

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

/**
 * The Space's own part of the sidebar, under Explore: its channels and the people the person has
 * direct messages with. Each row opens in the focused pane, and unread messages show at the right.
 */
function SpaceSections({
  space,
  route,
  onOpen,
  children,
}: {
  space: Space;
  route: string;
  onOpen(view: WorkspaceView): void;
  /** The person's agents with their chats, listed in Direct messages under the people. */
  children?: ReactNode;
}) {
  const { user } = useAuth();
  const { conversations, error, retry } = useSpaceConversations(space.id);
  const collapsed = useCollapsedSections((state) => state.value);
  const channelsOpen = !collapsed.includes("channels");
  const dmsOpen = !collapsed.includes("dms");
  const [channels, dms] = useMemo(() => {
    const [channelGroup, dmGroup] = groupConversations(conversations);
    return [channelGroup?.conversations ?? [], dmGroup?.conversations ?? []];
  }, [conversations]);
  const [path, query = ""] = route.split("?");
  const openConversation = path.includes("/social/misty")
    ? new URLSearchParams(query).get("conversation")
    : null;
  const open = (target: string) => openWorkspaceRoute(target, onOpen);

  const conversationRow = (conversation: (typeof conversations)[number]) => {
    const unread = conversation.unread_count ?? 0;
    return (
      <NavRow
        key={conversation.id}
        current={openConversation === conversation.id}
        onClick={() => open(conversationPath(space.id, conversation))}
      >
        <span className={markSlotClass}>
          {conversation.kind !== "dm" ? (
            <Hash aria-hidden="true" />
          ) : isGroupDirectMessage(conversation, user?.id) ? (
            <Users aria-hidden="true" />
          ) : null}
        </span>
        <NavRowLabel bright={unread > 0} className="flex-1">
          {conversationName(conversation, user?.id)}
        </NavRowLabel>
        {unread > 0 ? (
          <Text size="caption" tone="chrome" aria-label={`${unread} unread`}>
            {unread}
          </Text>
        ) : null}
      </NavRow>
    );
  };

  return (
    <>
      <section className={chatSectionClass} aria-label="Channels">
        <NavGroupHeading
          name="Channels"
          collapsible={{ open: channelsOpen, onToggle: () => toggleSection("channels") }}
        />
        {!channelsOpen ? null : error && !conversations.length ? (
          <ErrorState
            inline
            title="Channels couldn't load"
            line={error}
            action={{ label: "Try again", variant: "secondary", onClick: retry }}
          />
        ) : (
          channels.map(conversationRow)
        )}
      </section>
      <section className={chatSectionClass} aria-label="Direct messages" data-tour="sidebar-dms">
        <NavGroupHeading
          name="Direct messages"
          collapsible={{ open: dmsOpen, onToggle: () => toggleSection("dms") }}
        />
        {dmsOpen ? (
          <>
            {dms.map(conversationRow)}
            {children}
          </>
        ) : null}
      </section>
    </>
  );
}

/**
 * What the sidebar holds, top to bottom: the Space's selector, Home, Search and Explore, then the
 * Space's channels and direct messages. Apps launch from Home; the person's agent chats are listed
 * under Direct messages beside the people.
 * There is no New row: starting a direct message starts a chat. Lesson chats, and the chats Tutor's runs make,
 * live under Tutor instead.
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
  const [path, query = ""] = route.split("?");
  const params = new URLSearchParams(query);
  const view = path === "/agents" ? params.get("view") : null;
  const openChat = path === "/agents" && !view ? params.get("conversation") : null;
  const base = space ? `/spaces/${encodeURIComponent(space.id)}` : "";
  const open = (target: string) => openWorkspaceRoute(target, onOpen);

  return (
    <>
      {/* The selector and Search; the rows keep a visible gap, so a hovered row never runs into the
          current one. */}
      <nav
        className="mt-1.5 flex flex-none flex-col gap-1.5"
        aria-label="Space"
        data-tour="sidebar-space"
        data-misty-window-drag-block="true"
      >
        {space ? (
          <SpaceSelector space={space} onOpenHome={() => open(base)} />
        ) : (
          <Skeleton className="h-4 w-32" />
        )}
        <Row
          label="Home"
          icon={<House aria-hidden="true" />}
          current={Boolean(space) && (path === base || path === `${base}/home`)}
          onOpen={() => open(base)}
          data-tour="sidebar-home"
        />
        <Row
          label="Search"
          icon={<Search aria-hidden="true" />}
          shortcut="Meta+K"
          onOpen={() => useSearchDialog.getState().setOpen(true)}
          data-tour="sidebar-search"
        />
        <Row
          label="Explore"
          icon={<ExploreIcon aria-hidden="true" />}
          current={Boolean(space) && path === `${base}/explore`}
          onOpen={() => open(`${base}/explore`)}
          data-tour="sidebar-explore"
        />
      </nav>
      {/* The rest takes the room that is left and scrolls inside it. */}
      <nav
        className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-x-hidden overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        aria-label="Space conversations"
        data-misty-window-drag-block="true"
      >
        {space ? (
          <SpaceSections space={space} route={route} onOpen={onOpen}>
            {conversationsError && !conversations.length ? (
              // The reads go on behind this; the first that works brings the list.
              <ErrorState
                inline
                title="Agent chats couldn't load"
                line={conversationsError}
                action={{
                  label: "Try again",
                  variant: "secondary",
                  onClick: () => void useMistyStore.getState().loadConversations(),
                }}
              />
            ) : chatsPending ? (
              <RowSkeletons count={3} />
            ) : (
              <SidebarAgentThreads
                agents={agents}
                chats={chats}
                statuses={statuses}
                openChat={openChat}
                onOpen={(agent, chatId) => open(agentChatRoute(agent.id, chatId))}
              />
            )}
          </SpaceSections>
        ) : (
          <RowSkeletons count={6} />
        )}
      </nav>
    </>
  );
}
