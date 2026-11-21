import type { MistyPickerSource } from "@/features/files";
import { ChannelMain, type ActionBarItem } from "@misty/ui";
import { SpaceChatHeader } from "./components/SpaceChatHeader";
import { SpaceChatComposer } from "./composer/SpaceChatComposer";
import { ChatMemberList } from "./components/ChatMemberList";
import { SpaceChatSearch } from "./components/SpaceChatSearch";
import { useSpacesStore } from "../list/useSpacesStore";
import { spaceCan, useMemberColors, useSpaceRoles } from "../roles/useSpaceRoles";
import { isPrivateChannel } from "./sidebar/conversationGroups";
import { useChatSidebarPreferences } from "./sidebar/chatSidebarPreferences";
import { useSpaceEveryoneUnread } from "./spaceConversationsResource";
import { useAuth } from "@/features/account";
import { useNativeSessionStore } from "@/features/account";
import { useSpaceChatDraft } from "./composer/useSpaceChatDraft";
import { useWorkspaceViewTitle } from "@/features/app-windows";
import { SpaceSetupCards } from "../components/SpaceSetupCards";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { spaceChatPath } from "./chatRoute";
import { DeleteMessageDialog } from "./components/ChatMessages";
import { conversationName, isGroupDirectMessage } from "./sidebar/conversationGroups";
import { SpaceChatThread } from "./components/SpaceChatThread";
import { useChatScrollRestoration } from "./hooks/useChatScrollRestoration";
import { useChatSuggestions } from "./hooks/useChatSuggestions";
import { useComposerInput } from "./hooks/useComposerInput";
import { useMessageDeleteTarget } from "./hooks/useMessageDeleteTarget";
import { useMessageEditing } from "./hooks/useMessageEditing";
import { useSpaceChatScope, useSpaceChatStore } from "./hooks/useSpaceChatData";
import { useSpaceChatMessageActions } from "./hooks/useSpaceChatMessageActions";
import { useSpaceChatAccess } from "./hooks/useSpaceChatAccess";
import { useSpaceChatTyping } from "./hooks/useSpaceChatTyping";
import { useSpaceConversationChat } from "./hooks/useSpaceConversationChat";
import { useSpaceChatAiAdapter } from "./hooks/useSpaceChatAiAdapter";
import { useChatReadReceipts } from "./hooks/useChatReadReceipts";
import { ConversationLoadState, ConversationUnavailable } from "./components/ConversationStates";
import { useBringMentionedAgents, useOwnMentionableAgents } from "./ownAgents";
import { ChatThreadColumn } from "./components/ChatThreadColumn";
import { ChatThreadsList } from "./components/ChatThreadsList";
import { useSpaceThread } from "./hooks/useSpaceThread";
import { useChatSidePanel } from "./chatSidePanelStore";
export function SpaceChat({
  spaceId,
  spaceName,
  workspaceTabId,
  conversationId: openConversationId,
  panel = false,
  onBack,
  searchedText = "",
  actions: barActions,
  search,
  dm,
}: {
  spaceId: string;
  spaceName: string;
  workspaceTabId?: string;
  /** The chat to show instead of the page's `conversation` parameter, as the side panel does. */
  conversationId?: string;
  /** In the side panel the header switcher names the chat, so no title row is drawn. */
  panel?: boolean;
  /** Where "Back to chat" goes when the open chat is gone; defaults to the chat page. */
  onBack?: () => void;
  /** The message search run from the page's controls; its results take the member list's place. */
  searchedText?: string;
  /** The chat's icon buttons in its bar under the tabs (the chat page's); none in the side panel. */
  actions?: ReadonlyArray<ActionBarItem>;
  /** The message search, last in the chat's bar. */
  search?: ReactNode;
  /** The chat is a DM (a Space of kind "direct"): named for its people, no setup cards, and no
   * composer while it is read-only. Its page names the tab. */
  /** A DM, which brings its own member list (`members`) since it is no Space of the list. */
  dm?: { name: string; group: boolean; readOnly: boolean; members?: ReactNode };
}) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user: authUser } = useAuth();
  const setupUser = useNativeSessionStore((state) => state.status?.current_user ?? null);
  const user = authUser ?? setupUser;
  const conversationId = openConversationId ?? searchParams.get("conversation") ?? "";
  const chatRootRef = useRef<HTMLDivElement>(null);
  const threadRootId = useChatSidePanel((panel) => panel.threadRootId);
  const threadSnapshot = useChatSidePanel((panel) => panel.threadRoot);
  const threadsListOpen = useChatSidePanel((panel) => panel.threadsListOpen);
  // Panels belong to the chat they were opened in.
  useEffect(() => useChatSidePanel.getState().reset(), [spaceId, conversationId]);
  // A link to a thread (a file's, opened from the app it's open in) opens it beside the chat.
  const threadParam = searchParams.get("thread") ?? "";
  useEffect(() => {
    if (threadParam) useChatSidePanel.getState().openThread(threadParam);
  }, [spaceId, conversationId, threadParam]);
  const endRef = useRef<HTMLDivElement | null>(null);
  const store = useSpaceChatStore();
  const conversationChat = useSpaceConversationChat(spaceId, conversationId);
  const scope = useSpaceChatScope({
    spaceId,
    conversationId,
    currentUserId: user?.id,
    conversations: conversationChat.conversations,
    conversationMessages: conversationChat.messages,
    store,
  });
  const access = useSpaceChatAccess(spaceId);
  const typing = useSpaceChatTyping({
    spaceId,
    conversationId,
    currentUserId: user?.id,
    members: scope.members,
  });
  const space = useSpacesStore((state) => state.spaces.find((item) => item.id === spaceId));
  const roles = useSpaceRoles(spaceId);
  const myRoleIds = useSpacesStore(
    (state) =>
      state.membersBySpace[spaceId]?.find((member) => member.user_id === user?.id)?.role_ids,
  );
  // The roles the person may @mention: those open to it, or every one for the owner and admins.
  const mentionableRoles = useMemo(() => {
    const anyRole = space?.role === "owner" || spaceCan(space, "administrator");
    return (roles ?? []).filter((role) => !role.is_default && (role.mentionable || anyRole));
  }, [roles, space]);
  const memberColors = useMemberColors(spaceId);
  const everyoneUnread = useSpaceEveryoneUnread(spaceId);
  const preferences = useChatSidebarPreferences((state) => state.value);
  const membersShown = !preferences.hideMembers;
  const conversation = scope.activeConversation;
  const isDirect = conversation?.kind === "dm";
  const channelName = conversation ? conversationName(conversation, user?.id) : "everyone";
  const defaultRoleId = roles?.find((role) => role.is_default)?.id;
  const privateChannel = Boolean(conversation && isPrivateChannel(conversation, defaultRoleId));
  // In a channel the server says what the person may do there; elsewhere the Space's word holds.
  const canManageMessages = conversation?.permissions
    ? conversation.permissions.includes("messages.manage") ||
      spaceCan(space, "administrator") ||
      space?.role === "owner"
    : spaceCan(space, "messages.manage");
  useWorkspaceViewTitle(
    dm ? undefined : workspaceTabId,
    isDirect ? `@${channelName} · ${spaceName}` : `#${channelName} · ${spaceName}`,
  );
  // Where the unread messages begin, as they were when the chat opened: reading them clears the
  // count, but the line stays until another chat opens.
  const unreadAtOpen = useRef<{ key: string; count: number } | null>(null);
  const openKey = `${spaceId}:${conversationId}`;
  if (unreadAtOpen.current?.key !== openKey && (conversationId ? conversation : true))
    unreadAtOpen.current = {
      key: openKey,
      count: conversationId ? (conversation?.unread_count ?? 0) : everyoneUnread,
    };
  const unreadCount = unreadAtOpen.current?.count ?? 0;
  const fromOthers = unreadCount
    ? scope.messages.filter((message) => message.sender_user_id !== user?.id)
    : [];
  const firstUnreadId = unreadCount
    ? fromOthers[Math.max(0, fromOthers.length - unreadCount)]?.id
    : undefined;
  const draft = useSpaceChatDraft(spaceId, conversationId);
  const editing = useMessageEditing();
  // Only the person's own agents can be @mentioned, and so run; nobody runs anyone else's.
  const agents = useOwnMentionableAgents(user?.id);
  const bringMentionedAgents = useBringMentionedAgents(
    spaceId,
    agents,
    conversation && isGroupDirectMessage(conversation, user?.id) ? conversationId : "",
  );
  const threadState = useSpaceThread({
    spaceId,
    conversationId,
    rootId: threadRootId,
    currentUser: user ? { id: user.id, name: user.username } : undefined,
    members: scope.members,
    agents,
    roles: mentionableRoles,
    beforeSend: bringMentionedAgents,
  });
  const suggestions = useChatSuggestions({
    spaceId,
    members: scope.members,
    agents,
    currentUserId: user?.id,
    roles: mentionableRoles,
  });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSource, setPickerSource] = useState<MistyPickerSource>("files");
  const deleting = useMessageDeleteTarget([user?.id, spaceId, conversationId]);
  const messageToDelete = deleting.message;
  const clearDeleteTarget = deleting.clear;
  const resetEditing = editing.reset;
  const closeSuggestions = suggestions.setOpen;
  const clearSpacesError = store.clearSpacesError;
  const markRead = store.markRead;
  const loadEveryone = store.loadMessages;
  const referenceOnly = store.referenceOnly;
  // Everyone's history loads when the chat opens, however it was opened (a saved tab, the side
  // panel, a relaunch); a channel or direct chat loads its own (`useSpaceConversationChat`).
  useEffect(() => {
    if (conversationId || referenceOnly) return;
    void Promise.resolve(loadEveryone(spaceId)).catch(() => undefined);
  }, [spaceId, conversationId, referenceOnly, loadEveryone]);
  const openPicker = (source: MistyPickerSource) => {
    setPickerSource(source);
    setPickerOpen(true);
  };
  const input = useComposerInput({
    draft,
    suggestions,
    canWriteMessages: access.canWriteMessages,
    canUploadAttachments: access.canWriteMessages,
    openPicker,
  });
  const actions = useSpaceChatMessageActions({
    spaceId,
    conversationId,
    currentUser: user ? { id: user.id, name: user.username } : undefined,
    activeConversation: scope.activeConversation,
    members: scope.members,
    agents,
    roles: mentionableRoles,
    beforeSend: bringMentionedAgents,
    draft,
    editing,
    setGroupMessages: conversationChat.setMessages,
    setGroupChatError: conversationChat.setError,
    storeSendMessage: store.sendMessage,
    storeUpdateMessage: store.updateMessage,
    storeDeleteMessage: store.deleteMessage,
    storeToggleReaction: store.toggleMessageReaction,
  });
  const messagesLoading = conversationId
    ? conversationChat.loading && conversationChat.messages.length === 0
    : (store.messageLoadingBySpace[spaceId] ?? store.loading) && scope.defaultMessages.length === 0;
  const messagesError = conversationId
    ? conversationChat.error
    : (store.messageErrorsBySpace[spaceId] ?? "");
  const conversationAvailable = !conversationId || Boolean(scope.activeConversation);
  // How far back the open chat can still read, and reading the page before what it shows.
  const history = conversationId
    ? conversationChat.history
    : (store.messageHistoryBySpace[spaceId] ?? "more");
  const loadOlderConversation = conversationChat.loadOlder;
  const loadOlderEveryone = store.loadOlderMessages;
  const loadOlder = useCallback(() => {
    if (store.referenceOnly) return;
    if (conversationId) void loadOlderConversation();
    else void loadOlderEveryone(spaceId);
  }, [conversationId, loadOlderConversation, loadOlderEveryone, spaceId, store.referenceOnly]);
  const historyReady =
    !messagesLoading &&
    (!conversationId || conversationChat.loadedConversationId === conversationId);
  // A message to bring into view that isn't drawn yet (a reply's original from further back):
  // older pages load until it is. A search hit in the address does the same.
  const [jumpTargetId, setJumpTargetId] = useState("");
  useEffect(() => setJumpTargetId(""), [spaceId, conversationId]);
  const targetMessageId = jumpTargetId || searchParams.get("message") || "";
  const targetLoaded = Boolean(
    targetMessageId && scope.messages.some((message) => message.id === targetMessageId),
  );
  useEffect(() => {
    if (!targetMessageId || !historyReady) return;
    if (targetLoaded) {
      // In view now (the scroll hook has moved to it); a later click starts afresh.
      if (jumpTargetId) setJumpTargetId("");
      return;
    }
    if (history === "complete") {
      if (jumpTargetId) setJumpTargetId("");
      return;
    }
    if (history === "more") loadOlder();
  }, [history, historyReady, jumpTargetId, loadOlder, targetLoaded, targetMessageId]);
  useSpaceChatAiAdapter({
    spaceId,
    conversationId,
    available: conversationAvailable,
    canWrite: access.canWriteMessages,
    title: scope.activeConversation?.title,
    messages: scope.messages,
    draft,
  });
  const chatScroll = useChatScrollRestoration({
    viewerId: user?.id,
    spaceId,
    conversationId,
    ready: historyReady,
    messages: scope.messages,
    targetMessageId: targetMessageId || undefined,
    onReachTop: history === "more" ? loadOlder : undefined,
  });

  // Transient menus close on navigation; drafts remain scoped to their conversation.
  useEffect(() => {
    resetEditing();
    clearDeleteTarget();
    closeSuggestions(false);
    setPickerOpen(false);
    clearSpacesError();
  }, [
    clearDeleteTarget,
    clearSpacesError,
    closeSuggestions,
    resetEditing,
    conversationId,
    spaceId,
    store.referenceOnly,
    user?.id,
  ]);
  useChatReadReceipts({
    spaceId,
    conversationId,
    enabled: conversationAvailable && !store.referenceOnly,
    messages: scope.messages,
    markSpaceRead: markRead,
  });
  if (
    conversationId &&
    !scope.activeConversation &&
    (conversationChat.error || conversationChat.conversationsPending)
  )
    return (
      <ConversationLoadState error={conversationChat.error} onRetry={conversationChat.reload} />
    );
  if (!conversationAvailable)
    return (
      <ConversationUnavailable
        onBack={() => (onBack ? onBack() : navigate(spaceChatPath(spaceId), { replace: true }))}
      />
    );
  const thread = threadRootId ? (
    <ChatThreadColumn
      root={scope.messages.find((message) => message.id === threadRootId) ?? threadSnapshot}
      replies={threadState.replies}
      loading={threadState.loading}
      loadingOlder={threadState.loadingOlder}
      hasOlder={threadState.hasOlder}
      error={threadState.error}
      canWrite={access.canWriteMessages}
      typingLabel={typing.label}
      channelName={isDirect ? `@${channelName}` : `#${channelName}`}
      onTypingInput={typing.onTextInput}
      onStopTyping={typing.stop}
      onLoadOlder={threadState.loadOlder}
      onSend={threadState.send}
    />
  ) : threadsListOpen ? (
    <ChatThreadsList spaceId={spaceId} conversationId={conversationId} />
  ) : null;
  const chat = (
    <div ref={chatRootRef} className="flex min-h-0 min-w-0 flex-1 flex-col">
      {!conversationId && !dm ? (
        <SpaceSetupCards
          spaceId={spaceId}
          isOwner={access.isOwner}
          showInvitation={searchParams.get("created") === "1"}
          dismissible
        />
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col">
        <SpaceChatThread
          spaceId={spaceId}
          access={access}
          scope={scope}
          store={store}
          editing={editing}
          actions={actions}
          suggestions={suggestions}
          currentUserId={user?.id}
          error={messagesError}
          setError={conversationChat.setError}
          loading={messagesLoading}
          endRef={endRef}
          scrollRef={chatScroll.scrollRef}
          onScroll={chatScroll.onScroll}
          hasOlderMessages={history !== "complete"}
          onJumpToMessage={setJumpTargetId}
          memberColors={memberColors}
          myRoleIds={myRoleIds}
          canManageMessages={canManageMessages}
          firstUnreadId={firstUnreadId}
          channel={isDirect ? undefined : { name: channelName, private: privateChannel }}
          onOpenPicker={openPicker}
          onBeginMention={input.beginMention}
          onReply={(id) => {
            draft.setReplyToMessageId(id);
            requestAnimationFrame(() => chatRootRef.current?.querySelector("textarea")?.focus());
          }}
          onDelete={deleting.request}
          onReload={() => {
            if (conversationId) conversationChat.reload();
            else void store.loadMessages(spaceId);
          }}
        />
      </div>

      {dm?.readOnly ? null : (
        <SpaceChatComposer
          spaceId={spaceId}
          canWrite={access.canWriteMessages}
          isConversation={Boolean(conversationId)}
          draft={draft}
          suggestions={suggestions}
          input={input}
          typing={typing}
          messages={scope.messages}
          pickerOpen={pickerOpen}
          pickerSource={pickerSource}
          onOpenPicker={openPicker}
          onClosePicker={() => setPickerOpen(false)}
          onSubmit={(event) => void actions.submit(event)}
          onEditLast={() => {
            const mine = [...scope.messages]
              .reverse()
              .find(
                (message) =>
                  message.sender_kind === "person" &&
                  message.sender_user_id === user?.id &&
                  !message.local_delivery_state,
              );
            if (mine) editing.begin(mine);
          }}
          placeholder={
            dm || isDirect ? `Message @${dm?.name ?? channelName}` : `Message #${channelName}`
          }
        />
      )}

      <DeleteMessageDialog
        open={Boolean(messageToDelete)}
        onOpenChange={(open) => {
          if (!open) deleting.clear();
        }}
        onConfirm={() => {
          if (!messageToDelete) return;
          void actions.remove(messageToDelete).then((removed) => {
            if (removed) deleting.clear();
          });
        }}
      />
    </div>
  );
  const members = !membersShown ? null : dm ? (
    (dm.members ?? null)
  ) : space ? (
      <ChatMemberList
        space={space}
        spaceId={spaceId}
        ownerUserId={space.owner_user_id}
        currentUserId={user?.id}
        visibleTo={
          // A DM, or a private channel, lists only the people who can read it.
          conversation && (isDirect || privateChannel)
            ? (member) =>
                conversation.participants.some((person) => person.user_id === member.user_id)
            : undefined
        }
      />
    ) : null;
  const searchResults = searchedText ? (
    <SpaceChatSearch
      spaceId={spaceId}
      query={searchedText}
      conversations={conversationChat.conversations}
      currentUserId={user?.id}
      memberColors={memberColors}
      dm={Boolean(dm)}
    />
  ) : null;
  // The side panel has no room for the page's controls or a member list: the chat and its thread.
  if (panel)
    return (
      <div className="flex h-full min-h-0 min-w-0">
        {chat}
        {thread}
      </div>
    );
  // The chat's own bar, under the window's tabs, as Discord's: what the chat is, then its controls.
  const header = (
    <SpaceChatHeader
      direct={Boolean(dm) || isDirect}
      group={dm ? dm.group : Boolean(conversation && isGroupDirectMessage(conversation, user?.id))}
      locked={privateChannel}
      name={dm?.name ?? channelName}
      actions={barActions}
      end={search}
    />
  );
  // Search results, then a thread, take the member list's place.
  return (
    <ChannelMain header={header} side={searchResults ?? thread ?? members ?? undefined}>
      {chat}
    </ChannelMain>
  );
}
