import { Hash, LayoutGrid, Search, Volume2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/features/account";
import {
  homeSpaceOf,
  useChatStatuses,
  useAgentAccountId,
  useChatSectionsStore,
  useLessonStore,
  useMistyStore,
  usePersonalAgentsStore,
} from "@/features/agents";
import { dockLeaves, useWorkspaceStore, type WorkspaceView } from "@/features/app-windows";
import {
  friendsRoute,
  joinVoiceChannel,
  useActiveVoiceChannel,
  useCallSpeaking,
  voicePath,
} from "@/features/direct";
import { personInitials } from "@/shared/lib/person_initials";
import type { Space } from "@/features/spaces";
import {
  ChannelRowMenu,
  conversationName,
  conversationPath,
  GlobalCreateSpaceDialog,
  spaceChatPath,
  useSpaceEveryoneUnread,
  groupConversations,
  NewChannelButton,
  SpaceAppsLauncher,
  SpaceSelector,
  useAppLauncher,
  useSpacesStore,
  useSpaceConversations,
  useVoicePresence,
  useWindowSpace,
  watchVoicePresence,
} from "@/features/spaces";
import {
  Avatar,
  AvatarFallback,
  EmptyState,
  ErrorState,
  NavGroupHeading,
  NavRow,
  NavRowLabel,
  Skeleton,
  spaceIcons,
  Text,
  VoicePerson,
} from "@misty/ui";
import { toggleSection, useCollapsedSections } from "./collapsed_sections";
import { FriendsRow, PersonalSections } from "./PersonalSections";
import { usePlace, useSharedSpaces } from "./place_store";
import { JoinWithLink } from "./JoinWithLink";
import { SidebarAgentThreads } from "./SidebarAgentThreads";
import { SpaceInvitations } from "./SpaceInvitations";
import { SidebarMore, SidebarPinnedPlaces, type SidebarPlace } from "./SidebarPins";
import { useSidebarPins, type SidebarPlaceId } from "./sidebar_pins_store";
import { SidebarRow as Row } from "./SidebarRow";
import { useShortcutHandler } from "@/features/shortcuts";
import { chatSectionClass, markSlotClass } from "./styles";
import { useSearchDialog } from "./search/search_store";
import { agentChatRoute, agentSharedThreadRoute, openWorkspaceRoute } from "./space_navigation";

const ExploreIcon = spaceIcons.explore;

const placeLabels: Record<SidebarPlaceId, string> = { files: "Files" };

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

function SpaceSections({
  space,
  route,
  onOpen,
}: {
  space: Space;
  route: string;
  onOpen(view: WorkspaceView): void;
}) {
  const { user } = useAuth();
  const { conversations, error, retry } = useSpaceConversations(space.id);
  const collapsed = useCollapsedSections((state) => state.value);
  const channelsOpen = !collapsed.includes("channels");
  const channels = useMemo(
    () => groupConversations(conversations)[0]?.conversations ?? [],
    [conversations],
  );
  const [path, query = ""] = route.split("?");
  const inChat = path.includes("/social/misty");
  const openConversation = inChat ? new URLSearchParams(query).get("conversation") : null;
  const open = (target: string) => openWorkspaceRoute(target, onOpen);
  const everyoneUnread = useSpaceEveryoneUnread(space.id);
  const everyoneOpen = inChat && !openConversation;
  useEffect(() => watchVoicePresence(space.id), [space.id]);
  const inVoice = useVoicePresence((state) => state.bySpace[space.id]);
  const activeVoice = useActiveVoiceChannel();
  const speaking = useCallSpeaking();
  const members = useSpacesStore((state) => state.membersBySpace[space.id]);

  const voiceRow = (conversation: (typeof conversations)[number]) => {
    const here = activeVoice?.spaceId === space.id && activeVoice.channelId === conversation.id;
    const people = inVoice?.[conversation.id] ?? [];
    const join = () => {
      open(voicePath(space.id, conversation.id));
      if (user?.id && !here)
        void joinVoiceChannel(
          { spaceId: space.id, channelId: conversation.id, name: conversation.title },
          user.id,
        );
    };
    return (
      <div key={conversation.id}>
        <ChannelRowMenu spaceId={space.id} conversation={conversation} onDeleted={() => undefined}>
          <NavRow current={here} onClick={join}>
            <span className={markSlotClass}>
              <Volume2 aria-hidden="true" />
            </span>
            <NavRowLabel bright={here} className="flex-1">
              {conversation.title}
            </NavRowLabel>
          </NavRow>
        </ChannelRowMenu>
        {people.map((userId) => {
          const name = members?.find((member) => member.user_id === userId)?.name ?? "Someone";
          return (
            <VoicePerson
              key={userId}
              name={name}
              speaking={here && speaking.includes(userId)}
              avatar={
                <Avatar size="xs">
                  <AvatarFallback>{personInitials(name)}</AvatarFallback>
                </Avatar>
              }
            />
          );
        })}
      </div>
    );
  };

  const conversationRow = (conversation: (typeof conversations)[number]) => {
    if (conversation.voice) return voiceRow(conversation);
    const unread = conversation.unread_count ?? 0;
    const here = openConversation === conversation.id;
    const row = (
      <NavRow
        key={conversation.id}
        current={here}
        onClick={() => open(conversationPath(space.id, conversation))}
      >
        <span className={markSlotClass}>
          <Hash aria-hidden="true" />
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
    return (
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
    </>
  );
}

export function SpaceNavigator({ onOpen }: { onOpen(view: WorkspaceView): void }) {
  const accountId = useAgentAccountId();
  const space = useWindowSpace();
  const place = usePlace();
  const sharedSpaces = useSharedSpaces();
  const allSpaces = useSpacesStore((state) => state.spaces);
  const { sessionExpired } = useAuth();
  const spacesPending = useSpacesStore((state) => !sessionExpired && state.loading && !state.error);
  const agents = usePersonalAgentsStore((state) => state.agents);
  const conversations = useMistyStore((state) => state.conversations);
  const conversationsLoading = useMistyStore((state) => state.conversationsLoading);
  const conversationsError = useMistyStore((state) => state.conversationsError);
  const [chatsReadFor, setChatsReadFor] = useState<string | null>(null);
  const lessons = useLessonStore((state) => state.lessons);
  const route = useFocusedRoute();
  const statuses = useChatStatuses();
  useEffect(() => {
    void usePersonalAgentsStore.getState().load(accountId);
    void useLessonStore.getState().load(accountId);
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
    return conversations
      .filter((chat) => chat.messages.length > 0 && !chat.place && !lessons[chat.id])
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [conversations, lessons]);
  const [path, query = ""] = route.split("?");
  const params = new URLSearchParams(query);
  const view = path === "/agents" ? params.get("view") : null;
  const openAgent = path === "/agents" && !view ? params.get("agent") : null;
  const shownConversation = useMistyStore((state) => state.activeConversationId);
  const agentPlace = {
    agent: openAgent,
    conversation: !openAgent || params.get("new")
      ? null
      : (params.get("conversation") ?? (shownConversation || null)),
    thread: openAgent ? params.get("thread") : null,
  };
  const spaceAgents = useMemo(
    () => (space ? agents.filter((agent) => homeSpaceOf(accountId, agent) === space.id) : []),
    [agents, accountId, space],
  );
  const base = space ? `/spaces/${encodeURIComponent(space.id)}` : "";
  const open = (target: string) => openWorkspaceRoute(target, onOpen);
  useEffect(() => void useSidebarPins.getState().load(), []);
  const placeRoutes: Record<SidebarPlaceId, string> = {
    files: "/agents?view=files",
  };
  const places = Object.fromEntries(
    (Object.keys(placeLabels) as SidebarPlaceId[]).map((id) => [
      id,
      {
        label: placeLabels[id],
        command: `app.open_${id}`,
        icon: spaceIcons[id],
        current: view === id,
        open: () => open(placeRoutes[id]),
      } satisfies SidebarPlace,
    ]),
  ) as Record<SidebarPlaceId, SidebarPlace>;
  useShortcutHandler("app.open_explore", () => open(`${base}/explore`), Boolean(space));
  useShortcutHandler("app.open_files", () => open(placeRoutes.files), Boolean(space));
  useShortcutHandler(
    "app.open_apps",
    () => useAppLauncher.getState().setOpen(true),
    Boolean(space),
  );
  useShortcutHandler("app.open_friends", () => open(friendsRoute), Boolean(space));

  if (place === "spaces" && allSpaces.length > 0 && !sharedSpaces.length)
    return (
      <GlobalCreateSpaceDialog>
        {(create) => (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="mt-1.5 flex-none">
              <SpaceInvitations />
            </div>
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2">
              <EmptyState
                inline
                title="No Spaces yet"
                line="Spaces are where you work with other people."
                action={{ label: "Create a Space", onClick: create }}
              />
              <JoinWithLink />
            </div>
          </div>
        )}
      </GlobalCreateSpaceDialog>
    );

  return (
    <>
      <nav
        className="mt-1.5 flex flex-none flex-col gap-1.5"
        aria-label="Space"
        data-tour="sidebar-space"
        data-misty-window-drag-block="true"
      >
        {space ? (
          <SpaceSelector space={space} place={place} />
        ) : spacesPending ? (
          <Skeleton className="h-4 w-32" />
        ) : null}
        <Row
          label="Search"
          icon={<Search aria-hidden="true" />}
          command="app.command_palette"
          onOpen={() => useSearchDialog.getState().setOpen(true)}
          data-tour="sidebar-search"
        />
        <Row
          label="Explore"
          icon={<ExploreIcon aria-hidden="true" />}
          current={Boolean(space) && path === `${base}/explore`}
          command="app.open_explore"
          onOpen={() => open(`${base}/explore`)}
          data-tour="sidebar-explore"
        />
        {space ? <SidebarPinnedPlaces places={places} /> : null}
        <Row
          label="Apps"
          icon={<LayoutGrid aria-hidden="true" />}
          command="app.open_apps"
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
            {place === "personal" ? <FriendsRow route={route} onOpen={onOpen} /> : null}
            <SidebarMore places={places} />
          </>
        ) : null}
      </nav>
      <nav
        className="mt-4 flex min-h-0 flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        aria-label="Space conversations"
        data-misty-window-drag-block="true"
      >
        {!space ? null : place === "personal" ? (
          <PersonalSections route={route} onOpen={onOpen} />
        ) : (
          <>
            <SpaceInvitations />
            <SpaceSections space={space} route={route} onOpen={onOpen} />
          </>
        )}
        {space ? (
          <SidebarAgentThreads
            agents={spaceAgents}
            chats={chats}
            statuses={statuses}
            here={agentPlace}
            spaceId={space.id}
            accountId={accountId}
            onOpen={(agent) => open(agentChatRoute(agent.id))}
            onNewThread={(agent) => open(agentChatRoute(agent.id, undefined, true))}
            onOpenThread={(agent, conversationId) => open(agentChatRoute(agent.id, conversationId))}
            onOpenShared={(agent, threadId) => open(agentSharedThreadRoute(agent.id, threadId))}
          >
            {conversationsError && !conversations.length ? (
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
            ) : undefined}
          </SidebarAgentThreads>
        ) : null}
        {!space && spacesPending ? <RowSkeletons count={6} /> : null}
      </nav>
    </>
  );
}
