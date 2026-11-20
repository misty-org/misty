import { Hash, LayoutGrid, Search, Users } from "lucide-react";
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
  ChannelRowMenu,
  conversationName,
  conversationPath,
  NewDirectMessageButton,
  spaceChatPath,
  useSpaceEveryoneUnread,
  groupConversations,
  isGroupDirectMessage,
  NewChannelButton,
  SpaceAppsLauncher,
  SpaceSelector,
  useAppLauncher,
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
import { SidebarMore, SidebarPinnedPlaces, type SidebarPlace } from "./SidebarPins";
import { useSidebarPins, type SidebarPlaceId } from "./sidebarPinsStore";
import { SidebarRow as Row } from "./SidebarRow";
import { chatSectionClass, markSlotClass } from "./styles";
import { useSearchDialog } from "./search/searchStore";
import { agentChatRoute, openWorkspaceRoute } from "./spaceNavigation";

const ExploreIcon = spaceIcons.explore;

/** Misty's own places: the Space's Files, then the Lab and Code pages. */
const placeLabels: Record<SidebarPlaceId, string> = { files: "Files", lab: "Lab", code: "Code" };

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
  const inChat = path.includes("/social/misty");
  const openConversation = inChat ? new URLSearchParams(query).get("conversation") : null;
  const open = (target: string) => openWorkspaceRoute(target, onOpen);
  // `everyone`, the Space's own channel, is its chat with no conversation picked.
  const everyoneUnread = useSpaceEveryoneUnread(space.id);
  const everyoneOpen = inChat && !openConversation;

  const conversationRow = (conversation: (typeof conversations)[number]) => {
    const unread = conversation.unread_count ?? 0;
    const here = openConversation === conversation.id;
    const row = (
      <NavRow
        key={conversation.id}
        current={here}
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
    // A channel's actions are its right-click menu: invite, and edit or delete for its managers.
    return conversation.kind === "dm" ? (
      row
    ) : (
      <ChannelRowMenu
        key={conversation.id}
        spaceId={space.id}
        conversation={conversation}
        onDeleted={() => (here ? open(spaceChatPath(space.id)) : undefined)}
      >
        {row}
      </ChannelRowMenu>
    );
  };

  return (
    <>
      <section className={chatSectionClass} aria-label="Channels" data-tour="space-chat-channels">
        <NavGroupHeading
          name="Channels"
          collapsible={{ open: channelsOpen, onToggle: () => toggleSection("channels") }}
          className="group/row"
        >
          <NewChannelButton
            spaceId={space.id}
            onCreated={(created) => open(conversationPath(space.id, created))}
          />
        </NavGroupHeading>
        {!channelsOpen ? null : error && !conversations.length ? (
          <ErrorState
            inline
            title="Channels couldn't load"
            line={error}
            action={{ label: "Try again", variant: "secondary", onClick: retry }}
          />
        ) : (
          <>
            <ChannelRowMenu spaceId={space.id}>
              <NavRow current={everyoneOpen} onClick={() => open(spaceChatPath(space.id))}>
                <span className={markSlotClass}>
                  <Hash aria-hidden="true" />
                </span>
                <NavRowLabel bright={everyoneUnread > 0} className="flex-1">
                  everyone
                </NavRowLabel>
                {everyoneUnread > 0 ? (
                  <Text size="caption" tone="chrome" aria-label={`${everyoneUnread} unread`}>
                    {everyoneUnread}
                  </Text>
                ) : null}
              </NavRow>
            </ChannelRowMenu>
            {channels.map(conversationRow)}
          </>
        )}
      </section>
      <section className={chatSectionClass} aria-label="Direct messages" data-tour="sidebar-dms">
        <NavGroupHeading
          name="Direct messages"
          collapsible={{ open: dmsOpen, onToggle: () => toggleSection("dms") }}
          className="group/row"
        >
          <NewDirectMessageButton
            spaceId={space.id}
            onOpened={(opened) => open(conversationPath(space.id, opened))}
          />
        </NavGroupHeading>
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
 * What the sidebar holds, top to bottom: the Space's selector, Search, Explore, Misty's own
 * places (Files, Lab and Code, in the person's order), Apps (a launcher over the window), More (the
 * places they unpinned), then the Space's channels and direct messages. A Space has no home
 * page: its address opens its chat. The person's agent chats are listed under Direct messages
 * beside the people.
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
            !chat.place &&
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
  useEffect(() => void useSidebarPins.getState().load(), []);
  const placeRoutes: Record<SidebarPlaceId, string> = {
    files: `${base}/files`,
    lab: `${base}/lab`,
    code: "/agents?view=code",
  };
  const places = Object.fromEntries(
    (Object.keys(placeLabels) as SidebarPlaceId[]).map((id) => [
      id,
      {
        label: placeLabels[id],
        icon: spaceIcons[id],
        current:
          id === "code"
            ? view === "code"
            : Boolean(space) &&
              (path === placeRoutes[id] || path.startsWith(`${placeRoutes[id]}/`)),
        open: () => open(placeRoutes[id]),
      } satisfies SidebarPlace,
    ]),
  ) as Record<SidebarPlaceId, SidebarPlace>;

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
        {space ? <SpaceSelector space={space} /> : <Skeleton className="h-4 w-32" />}
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
        {space ? <SidebarPinnedPlaces places={places} /> : null}
        {/* The Space's apps, in a launcher over the window rather than a page. */}
        <Row
          label="Apps"
          icon={<LayoutGrid aria-hidden="true" />}
          onOpen={() => useAppLauncher.getState().setOpen(true)}
          data-tour="sidebar-apps"
        />
        {space ? (
          <>
            <SpaceAppsLauncher
              spaceId={space.id}
              isMod={Boolean(space.permissions?.includes("apps.manage"))}
              onOpen={open}
            />
            {/* More comes last: the places the person unpinned, and reordering the pins. */}
            <SidebarMore places={places} />
          </>
        ) : null}
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
