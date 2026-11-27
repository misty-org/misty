import { Search } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
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
import { avatarOutline } from "@/shared/lib/avatar_decoration";
import { noticesMuted, useMessageNotices } from "@/shared/lib/message_notices";
import type { Space } from "@/features/spaces";
import type { AgentProfile } from "@/shared/schemas";
import {
  ChannelRowMenu,
  conversationName,
  conversationPath,
  GlobalCreateSpaceDialog,
  spaceChatPath,
  useSpaceEveryoneUnread,
  channelLayout,
  ChannelCategoryList,
  ChannelHeadingTools,
  ChannelList,
  SpaceSelector,
  useSpacesStore,
  useSpaceConversations,
  useVoicePresence,
  useWindowSpace,
  watchVoicePresence,
} from "@/features/spaces";
import {
  Avatar,
  AvatarFallback,
  CountMark,
  EmptyState,
  ErrorState,
  NavGroupHeading,
  NavRow,
  NavRowLabel,
  Skeleton,
  spaceIcons,
  VoiceFaces,
} from "@misty/ui";
import { toggleSection, useCollapsedSections } from "./collapsed_sections";
import { PersonalSections } from "./PersonalSections";
import { SidebarPlaces } from "./SidebarPlaces";
import { SpaceDockNav } from "./SpaceDockNav";
import { usePlace, useSharedSpaces } from "./place_store";
import { JoinWithLink } from "./JoinWithLink";
import { SidebarAgentThreads } from "./SidebarAgentThreads";
import { SpaceInvitations } from "./SpaceInvitations";
import { SidebarRow as Row } from "./SidebarRow";
import { useShortcutHandler } from "@/features/shortcuts";
import { chatSectionClass, markSlotClass } from "./styles";
import { useSearchDialog } from "./search/search_store";
import { agentChatRoute, agentSharedThreadRoute, openWorkspaceRoute } from "./space_navigation";

const ChannelIcon = spaceIcons.channel;
const VoiceIcon = spaceIcons.voice;

export function useFocusedRoute(): string {
  return useWorkspaceStore((state) => {
    const pane = dockLeaves(state.layout.root).find(
      (leaf) => leaf.id === state.layout.focusedPaneId,
    );
    return pane?.views.find((view) => view.id === pane.activeViewId)?.route ?? "";
  });
}

function useTabbedAgents(): string[] {
  const joined = useWorkspaceStore((state) => {
    const ids = new Set<string>();
    for (const leaf of dockLeaves(state.layout.root))
      for (const view of leaf.views) {
        const [path, query = ""] = (view.route ?? "").split("?");
        if (path !== "/agents") continue;
        const params = new URLSearchParams(query);
        const agent = params.get("view") ? null : params.get("agent");
        if (agent) ids.add(agent);
      }
    return [...ids].sort().join(",");
  });
  return useMemo(() => (joined ? joined.split(",") : []), [joined]);
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
  agents,
}: {
  space: Space;
  route: string;
  onOpen(view: WorkspaceView): void;
  agents?: ReactNode;
}) {
  const { user } = useAuth();
  const { conversations, categories, error, retry } = useSpaceConversations(space.id);
  const collapsed = useCollapsedSections((state) => state.value);
  const channelsOpen = !collapsed.includes("channels");
  const layout = useMemo(
    () => channelLayout(conversations, categories),
    [conversations, categories],
  );
  const orderedCategories = useMemo(
    () => layout.categories.map((group) => group.category),
    [layout],
  );
  const [path, query = ""] = route.split("?");
  const inChat = path.includes("/social/misty");
  const openConversation = inChat ? new URLSearchParams(query).get("conversation") : null;
  const open = (target: string) => openWorkspaceRoute(target, onOpen);
  const notices = useMessageNotices((state) => state.value);
  const everyoneMuted = noticesMuted(notices, space.id, "");
  const everyoneCount = useSpaceEveryoneUnread(space.id);
  const everyoneUnread = everyoneMuted ? 0 : everyoneCount;
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
          <NavRow
            current={here}
            muted={noticesMuted(notices, space.id, conversation.id)}
            onClick={join}
          >
            <span className={markSlotClass}>
              <VoiceIcon aria-hidden="true" />
            </span>
            <NavRowLabel bright={here} className="flex-1">
              {conversation.title}
            </NavRowLabel>
            <VoiceFaces
              people={people.map((userId) => {
                const member = members?.find((candidate) => candidate.user_id === userId);
                const name = member?.name ?? "Someone";
                return {
                  name,
                  speaking: here && speaking.includes(userId),
                  avatar: (
                    <Avatar size="xs" outline={avatarOutline(member?.avatar_decoration)}>
                      <AvatarFallback>{personInitials(name)}</AvatarFallback>
                    </Avatar>
                  ),
                };
              })}
            />
          </NavRow>
        </ChannelRowMenu>
      </div>
    );
  };

  const conversationRow = (conversation: (typeof conversations)[number]) => {
    if (conversation.voice) return voiceRow(conversation);
    const muted = noticesMuted(notices, space.id, conversation.id);
    const unread = muted ? 0 : (conversation.unread_count ?? 0);
    const here = openConversation === conversation.id;
    const row = (
      <NavRow
        key={conversation.id}
        current={here}
        muted={muted}
        onClick={() => open(conversationPath(space.id, conversation))}
      >
        <span className={markSlotClass}>
          <ChannelIcon aria-hidden="true" />
        </span>
        <NavRowLabel bright={unread > 0} className="flex-1">
          {conversationName(conversation, user?.id)}
        </NavRowLabel>
        <CountMark count={unread} label={`${unread} unread`} />
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
          <ChannelHeadingTools
            spaceId={space.id}
            categories={orderedCategories}
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
              <NavRow
                current={everyoneOpen}
                muted={everyoneMuted}
                onClick={() => open(spaceChatPath(space.id))}
              >
                <span className={markSlotClass}>
                  <ChannelIcon aria-hidden="true" />
                </span>
                <NavRowLabel bright={everyoneUnread > 0} className="flex-1">
                  everyone
                </NavRowLabel>
                <CountMark count={everyoneUnread} label={`${everyoneUnread} unread`} />
              </NavRow>
            </ChannelRowMenu>
            <ChannelList
              spaceId={space.id}
              categoryId={null}
              channels={layout.loose}
              className={chatSectionClass}
              row={conversationRow}
            />
          </>
        )}
        {channelsOpen ? agents : null}
      </section>
      <ChannelCategoryList
        spaceId={space.id}
        layout={layout}
        keepShown={[
          openConversation,
          activeVoice?.spaceId === space.id ? activeVoice.channelId : null,
        ]}
        className="flex flex-none flex-col gap-4"
        sectionClassName={chatSectionClass}
        row={conversationRow}
        onCreated={(created) => open(conversationPath(space.id, created))}
      />
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
  const tabbedAgents = useTabbedAgents();
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
    conversation:
      !openAgent || params.get("new")
        ? null
        : (params.get("conversation") ?? (shownConversation || null)),
    thread: openAgent ? params.get("thread") : null,
  };
  const spaceAgents = useMemo(
    () => (space ? agents.filter((agent) => homeSpaceOf(accountId, agent) === space.id) : []),
    [agents, accountId, space],
  );
  const open = (target: string) => openWorkspaceRoute(target, onOpen);
  useShortcutHandler("app.open_friends", () => open(friendsRoute), Boolean(space));

  const agentThreads = (shown: AgentProfile[], onClose?: () => void) =>
    space ? (
      <SidebarAgentThreads
        key={shown.length === 1 ? shown[0].id : undefined}
        agents={shown}
        chats={chats}
        statuses={statuses}
        here={agentPlace}
        tabbed={tabbedAgents}
        spaceId={space.id}
        accountId={accountId}
        onOpen={(agent) => open(agentChatRoute(agent.id))}
        onNewThread={(agent) => open(agentChatRoute(agent.id, undefined, true))}
        onOpenThread={(agent, conversationId) => open(agentChatRoute(agent.id, conversationId))}
        onOpenShared={(agent, threadId) => open(agentSharedThreadRoute(agent.id, threadId))}
        onClose={onClose}
      />
    ) : null;
  const agentsByRecency = useMemo(() => {
    const last = new Map<string, string>();
    for (const chat of chats)
      if (chat.agentId && !last.has(chat.agentId)) last.set(chat.agentId, chat.updatedAt);
    return spaceAgents
      .filter((agent) => agent.enabled && !agent.system_managed)
      .map((agent) => ({ agent, at: last.get(agent.id) ?? "" }));
  }, [chats, spaceAgents]);
  const agentsLoading = Boolean((conversationsError && !conversations.length) || chatsPending);

  const agentRows = space ? (
    <SidebarAgentThreads
      agents={spaceAgents}
      chats={chats}
      statuses={statuses}
      here={agentPlace}
      tabbed={tabbedAgents}
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
  ) : null;

  if (place === "spaces" && allSpaces.length > 0 && !sharedSpaces.length)
    return (
      <GlobalCreateSpaceDialog>
        {(create) => (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="mt-1.5 flex flex-none flex-col gap-1.5">
              <SidebarPlaces onOpen={onOpen} />
            </div>
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
        <Row
          label="Search"
          icon={<Search aria-hidden="true" />}
          command="app.command_palette"
          onOpen={() => useSearchDialog.getState().setOpen(true)}
          data-tour="sidebar-search"
        />
        <SidebarPlaces onOpen={onOpen} />
        <div className="mt-3">
          {space ? (
            <SpaceSelector space={space} place={place} />
          ) : spacesPending ? (
            <Skeleton className="h-4 w-32" />
          ) : null}
        </div>
      </nav>
      <nav
        className="mt-4 flex min-h-0 flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        aria-label="Space conversations"
        data-misty-window-drag-block="true"
      >
        {!space ? null : place === "personal" ? (
          <PersonalSections
            route={route}
            onOpen={onOpen}
            agents={agentsLoading ? agentRows : null}
            mixedAgents={agentsLoading ? [] : agentsByRecency}
            renderAgent={(agent, close) => agentThreads([agent], close)}
          />
        ) : (
          <>
            <SpaceInvitations />
            <SpaceSections space={space} route={route} onOpen={onOpen} agents={agentRows} />
          </>
        )}
        {!space && spacesPending ? <RowSkeletons count={6} /> : null}
      </nav>
      {place === "spaces" && sharedSpaces.length ? <SpaceDockNav /> : null}
    </>
  );
}
