import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Bot, LibraryBig, Paperclip, Send, Sparkles, Users, X } from "lucide-react";
import { useShallow } from "zustand/react/shallow";

import { useAuth } from "../../auth/AuthContext";
import { MistyFilePicker } from "../../components/MistyFilePicker/MistyFilePicker";
import { spacesApi } from "../../spaces/api";
import type {
  MessageAttachment,
  SpaceLibraryItem,
  SpaceMember,
  SpaceMessage,
  SpaceNode,
  SpaceStudioResource,
} from "../../spaces/types";
import { mergeSpaceMessages } from "../../stores/spaceMessageSpans";
import { buildMessageSpans, useSpacesStore } from "../../stores/useSpacesStore";
import { useSetupStore } from "../../stores/useSetupStore";
import { Button } from "../../components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "../../components/ui/command";
import { Popover, PopoverAnchor, PopoverContent } from "../../components/ui/popover";
import { Textarea } from "../../components/ui/textarea";
import { MistyLibraryPicker } from "./components/MistyLibraryPicker";
import { AgentConversationPanel } from "@/pages/Studio/AgentConversation";
import { useSpaceConversationChat } from "./useSpaceConversationChat";
import { DeleteMessageDialog, SpaceChatMessages } from "./components/SpaceChatMessages";

type ChatComposerSuggestion =
  | { kind: "member"; id: string; label: string; detail: string }
  | { kind: "agent"; id: string; label: string; detail: string }
  | { kind: "library"; id: string; label: string; detail: string; item: SpaceLibraryItem };

const emptyMessages: SpaceMessage[] = [];
const emptyMembers: SpaceMember[] = [];
const emptyNodes: SpaceNode[] = [];
const emptyStudioResources: SpaceStudioResource[] = [];

export function SpaceChat({ spaceId }: { spaceId: string }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user: authUser } = useAuth();
  const setupUser = useSetupStore((state) => state.status?.current_user ?? null);
  const user = authUser ?? setupUser;
  const activeSpace = useSpacesStore((state) => state.spaces.find((space) => space.id === spaceId));
  const permissions = activeSpace?.permissions;
  const canWriteMessages = permissions?.["messages.write"] !== false;
  const canUploadAttachments = canWriteMessages && permissions?.["attachments.upload"] !== false;
  const canBrowseLibrary = canWriteMessages && permissions?.["library.view"] !== false;
  const canRunAgents = canWriteMessages && permissions?.["agents.run"] !== false;
  const canCopyLibrary = permissions?.["library.download"] !== false;
  const canAddToLibrary = permissions?.["library.add"] !== false;
  const conversationId = searchParams.get("conversation") ?? "";
  const agentId = searchParams.get("agentId") ?? "";
  const agentConversationId = searchParams.get("agentConversationId") ?? "";
  const endRef = useRef<HTMLDivElement | null>(null);
  const suggestionsListId = useId();
  const [text, setText] = useState("");
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [selectedLibraryIds, setSelectedLibraryIds] = useState<string[]>([]);
  const [pendingAttachments, setPendingAttachments] = useState<MessageAttachment[]>([]);
  const [libraryItems, setLibraryItems] = useState<SpaceLibraryItem[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState("");
  const [suggestionQuery, setSuggestionQuery] = useState("");
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
  const [libraryBrowserOpen, setLibraryBrowserOpen] = useState(false);
  const [attachmentPickerOpen, setAttachmentPickerOpen] = useState(false);
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  const [replyToMessageId, setReplyToMessageId] = useState("");
  const [editingMessageId, setEditingMessageId] = useState("");
  const [editingText, setEditingText] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [messageToDelete, setMessageToDelete] = useState<SpaceMessage | null>(null);
  const {
    conversations: groupConversations,
    messages: groupMessages,
    setMessages: setGroupMessages,
    loading: groupLoading,
    error: groupChatError,
    setError: setGroupChatError,
  } = useSpaceConversationChat(spaceId, conversationId, permissions?.["messages.read"] !== false);
  const {
    messagesBySpace,
    membersBySpace,
    agentsBySpace,
    nodesBySpace,
    sending,
    sendMessage,
    updateMessage,
    deleteMessage,
    markRead,
    loadMessages,
    loadChatAgents,
    openNode,
  } = useSpacesStore(
    useShallow((state) => ({
      messagesBySpace: state.messagesBySpace,
      membersBySpace: state.membersBySpace,
      agentsBySpace: state.agentsBySpace,
      nodesBySpace: state.nodesBySpace,
      sending: state.sending,
      sendMessage: state.sendMessage,
      updateMessage: state.updateMessage,
      deleteMessage: state.deleteMessage,
      markRead: state.markRead,
      loadMessages: state.loadMessages,
      loadChatAgents: state.loadChatAgents,
      openNode: state.openNode,
    })),
  );
  const defaultMessages = messagesBySpace[spaceId] ?? emptyMessages;
  const allMembers = membersBySpace[spaceId] ?? emptyMembers;
  const agents = agentsBySpace[spaceId] ?? emptyStudioResources;
  const directAgent = agents.find((agent) => agent.id === agentId);
  const activeConversation = groupConversations.find(
    (conversation) => conversation.id === conversationId,
  );
  const allowedMemberIds = useMemo(
    () => new Set(activeConversation?.members.map((member) => member.user_id) ?? []),
    [activeConversation],
  );
  const members = conversationId
    ? allMembers.filter((member) => allowedMemberIds.has(member.user_id))
    : allMembers;
  const messages = conversationId ? groupMessages : defaultMessages;
  const nodes = useMemo(
    () => (nodesBySpace[spaceId] ?? emptyNodes).filter((node) => node.kind === "link"),
    [nodesBySpace, spaceId],
  );
  const suggestions = useMemo<ChatComposerSuggestion[]>(() => {
    const query = suggestionQuery.trim().toLocaleLowerCase();
    const peopleAndAgents: ChatComposerSuggestion[] = [
      ...members
        .filter((member) => member.user_id !== user?.id)
        .map((member) => ({
          kind: "member" as const,
          id: member.user_id,
          label: member.name,
          detail: member.email,
        })),
      ...(canRunAgents
        ? agents
            .filter((agent) => agent.enabled)
            .map((agent) => ({
              kind: "agent" as const,
              id: agent.id,
              label: agent.name,
              detail: agent.description || "Shared Agent",
            }))
        : []),
    ];
    const library =
      canBrowseLibrary && pendingAttachments.length + selectedLibraryIds.length < 5
        ? libraryItems
            .filter((item) => !selectedLibraryIds.includes(item.id))
            .map((item) => ({
              kind: "library" as const,
              id: item.id,
              label: item.display_name,
              detail: item.file.original_filename,
              item,
            }))
        : [];
    return [...peopleAndAgents, ...library]
      .filter(
        (item) => !query || `${item.label} ${item.detail}`.toLocaleLowerCase().includes(query),
      )
      .slice(0, 24);
  }, [
    agents,
    canBrowseLibrary,
    canRunAgents,
    libraryItems,
    members,
    pendingAttachments.length,
    selectedLibraryIds,
    suggestionQuery,
    user?.id,
  ]);

  useEffect(() => {
    setText("");
    setSelectedFileIds([]);
    setSelectedLibraryIds([]);
    setPendingAttachments([]);
    setSuggestionsOpen(false);
    setLibraryBrowserOpen(false);
    setAttachmentPickerOpen(false);
    setReplyToMessageId("");
    setEditingMessageId("");
    setEditingText("");
    if (canRunAgents) void loadChatAgents(spaceId);
    if (permissions?.["library.view"] === false) {
      setLibraryItems([]);
      return;
    }
    setSuggestionsLoading(true);
    setSuggestionsError("");
    void spacesApi
      .libraryItems(spaceId)
      .then((result) => setLibraryItems(result.items))
      .catch((error: unknown) => {
        setLibraryItems([]);
        setSuggestionsError(
          error instanceof Error ? error.message : "Library items could not be loaded.",
        );
      })
      .finally(() => setSuggestionsLoading(false));
  }, [canRunAgents, loadChatAgents, permissions, spaceId, user?.id]);

  useEffect(() => {
    const messageId = searchParams.get("message");
    const target = messageId ? document.getElementById(`message-${messageId}`) : endRef.current;
    target?.scrollIntoView({ block: messageId ? "center" : "end" });
    const last = messages[messages.length - 1];
    if (last && !conversationId) void markRead(spaceId, last.seq);
  }, [conversationId, markRead, messages, searchParams, spaceId]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = text.trim();
    if (
      !canWriteMessages ||
      (!value && pendingAttachments.length === 0 && selectedLibraryIds.length === 0)
    )
      return;
    try {
      if (conversationId) {
        const response = await spacesApi.sendConversationMessage(
          spaceId,
          conversationId,
          buildMessageSpans(value, members, agents),
          selectedFileIds,
          pendingAttachments.map((item) => item.id),
          selectedLibraryIds,
          replyToMessageId,
        );
        setGroupMessages((current) =>
          mergeSpaceMessages(current, [response.message, ...response.agent_replies]),
        );
      } else {
        await sendMessage(
          spaceId,
          value,
          selectedFileIds,
          pendingAttachments.map((item) => item.id),
          selectedLibraryIds,
          replyToMessageId,
        );
      }
      setText("");
      setSelectedFileIds([]);
      setSelectedLibraryIds([]);
      setPendingAttachments([]);
      setReplyToMessageId("");
      setSuggestionsOpen(false);
    } catch (reason) {
      if (conversationId)
        setGroupChatError(
          reason instanceof Error ? reason.message : "The group message could not be sent.",
        );
    }
  };

  const uploadAttachments = async (paths: string[]) => {
    if (!canUploadAttachments || paths.length === 0 || attachmentUploading) return;
    const available = Math.max(0, 5 - pendingAttachments.length - selectedLibraryIds.length);
    if (available === 0) return;
    setAttachmentUploading(true);
    try {
      const uploaded: MessageAttachment[] = [];
      for (const path of paths.slice(0, available)) {
        const result = await spacesApi.uploadLibraryPath(spaceId, path, "attachment");
        if (result.attachment) uploaded.push(result.attachment);
      }
      setPendingAttachments((current) => [...current, ...uploaded]);
    } finally {
      setAttachmentUploading(false);
    }
  };

  const openSuggestions = (query = "") => {
    if (!canWriteMessages) return;
    setSuggestionQuery(query);
    setActiveSuggestionIndex(0);
    setSuggestionsOpen(true);
  };

  const onComposerChange = (value: string) => {
    if (!canWriteMessages) return;
    if (/(^|\s)@files\s*$/i.test(value)) {
      setText(value.replace(/(^|\s)@files\s*$/i, "$1"));
      setSuggestionsOpen(false);
      if (canUploadAttachments && pendingAttachments.length + selectedLibraryIds.length < 5)
        setAttachmentPickerOpen(true);
      return;
    }
    if (/(^|\s)@library\s*$/i.test(value)) {
      setText(value.replace(/(^|\s)@library\s*$/i, "$1"));
      setSuggestionsOpen(false);
      if (canBrowseLibrary) setLibraryBrowserOpen(true);
      return;
    }
    setText(value);
    const match = value.match(/(?:^|\s)@([^\s@]*)$/);
    if (match) openSuggestions(match[1]);
    else {
      setSuggestionsOpen(false);
      setSuggestionQuery("");
    }
  };

  const selectSuggestion = (suggestion: ChatComposerSuggestion) => {
    if (suggestion.kind === "library") {
      if (!canBrowseLibrary || pendingAttachments.length + selectedLibraryIds.length >= 5) return;
      setSelectedLibraryIds((current) =>
        current.includes(suggestion.id) ? current : [...current, suggestion.id],
      );
      setText((current) => current.replace(/(^|\s)@[^\s@]*$/, "$1"));
    } else {
      setText((current) => current.replace(/(^|\s)@[^\s@]*$/, `$1@${suggestion.label} `));
    }
    setSuggestionsOpen(false);
    setSuggestionQuery("");
  };

  const cancelEditing = (messageId: string) => {
    setEditingMessageId("");
    setEditingText("");
    window.setTimeout(() => {
      document
        .querySelector<HTMLButtonElement>(
          `#message-${CSS.escape(messageId)} button[aria-label="Message actions"]`,
        )
        ?.focus();
    }, 0);
  };

  const saveEditedMessage = async (event: FormEvent, message: SpaceMessage) => {
    event.preventDefault();
    const value = editingText.trim();
    if (!canWriteMessages || !value || editSaving) return;
    setEditSaving(true);
    try {
      if (conversationId) {
        const saved = await spacesApi.updateConversationMessage(
          spaceId,
          conversationId,
          message.id,
          buildMessageSpans(value, members, agents),
          message.file_node_ids,
        );
        setGroupMessages((current) => mergeSpaceMessages(current, [saved]));
      } else {
        await updateMessage(spaceId, message.id, value, message.file_node_ids);
      }
      cancelEditing(message.id);
    } finally {
      setEditSaving(false);
    }
  };

  const removeMessage = async () => {
    if (!messageToDelete) return;
    if (conversationId) {
      await spacesApi.deleteConversationMessage(spaceId, conversationId, messageToDelete.id);
      setGroupMessages((current) => current.filter((item) => item.id !== messageToDelete.id));
    } else {
      await deleteMessage(spaceId, messageToDelete.id);
    }
    setMessageToDelete(null);
  };

  if (agentId) {
    return directAgent ? (
      <AgentConversationPanel
        agent={directAgent}
        conversationId={agentConversationId || undefined}
        embedded
        onClose={() => navigate(`/spaces/${encodeURIComponent(spaceId)}/chat`)}
      />
    ) : (
      <div className="grid h-full place-items-center p-8 text-center">
        <div className="max-w-sm">
          <span className="mx-auto grid size-12 place-items-center rounded-xl bg-muted/60">
            <Bot />
          </span>
          <h2 className="mt-4 text-base font-semibold">Agent chat unavailable</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            This Space Agent is disabled, missing, or unavailable to your role.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto] bg-background text-foreground">
      <SpaceChatMessages
        error={groupChatError}
        loading={groupLoading}
        messages={messages}
        currentUserId={user?.id}
        isOwner={activeSpace?.role === "owner"}
        canWrite={canWriteMessages}
        editingMessageId={editingMessageId}
        editingText={editingText}
        editSaving={editSaving}
        nodes={nodes}
        libraryItems={libraryItems}
        canCopyLibrary={canCopyLibrary}
        canAddToLibrary={canAddToLibrary}
        spaceId={spaceId}
        endRef={endRef}
        onEditingText={setEditingText}
        onCancelEditing={cancelEditing}
        onSaveEdited={(event, message) => {
          void saveEditedMessage(event, message);
        }}
        onReply={setReplyToMessageId}
        onBeginEditing={(message) => {
          setEditingMessageId(message.id);
          setEditingText(
            message.content
              .map((span) => (span.type === "text" ? span.text : `@${span.label}`))
              .join(""),
          );
        }}
        onDelete={setMessageToDelete}
        onOpenNode={(nodeId) => {
          void openNode(spaceId, nodeId);
        }}
        onError={setGroupChatError}
        onLibraryItem={(item) =>
          setLibraryItems((current) => [
            ...current.filter((candidate) => candidate.id !== item.id),
            item,
          ])
        }
        onReload={() => {
          void loadMessages(spaceId);
        }}
      />

      {canWriteMessages ? (
        <form
          className="mx-[clamp(16px,4vw,56px)] mb-4 rounded-xl border border-border/80 bg-card p-2 shadow-xs"
          onSubmit={(event) => void submit(event)}
        >
          {replyToMessageId ? (
            <div className="mb-2 flex items-center justify-between rounded-md border-l-2 border-primary bg-muted px-3 py-1.5 text-xs text-muted-foreground">
              <span>
                Replying to{" "}
                {messages.find((item) => item.id === replyToMessageId)?.sender_name ?? "message"}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                type="button"
                onClick={() => setReplyToMessageId("")}
                aria-label="Cancel reply"
              >
                <X />
              </Button>
            </div>
          ) : null}
          <Popover open={suggestionsOpen} onOpenChange={setSuggestionsOpen}>
            <PopoverAnchor asChild>
              <Textarea
                className="min-h-14 resize-none border-0 bg-transparent px-2 shadow-none focus-visible:ring-0"
                aria-label={conversationId ? "Message this group" : "Message this Space"}
                aria-autocomplete="list"
                aria-controls={suggestionsOpen ? suggestionsListId : undefined}
                aria-expanded={suggestionsOpen}
                aria-haspopup="listbox"
                aria-activedescendant={
                  suggestionsOpen && suggestions[activeSuggestionIndex]
                    ? `${suggestionsListId}-option-${activeSuggestionIndex}`
                    : undefined
                }
                role="combobox"
                maxLength={4000}
                placeholder="Write a message… Use @ to mention or add"
                value={text}
                onChange={(event) => onComposerChange(event.target.value)}
                onKeyDown={(event) => {
                  if (suggestionsOpen && event.key === "ArrowDown") {
                    event.preventDefault();
                    setActiveSuggestionIndex((current) =>
                      Math.min(current + 1, Math.max(0, suggestions.length - 1)),
                    );
                    return;
                  }
                  if (suggestionsOpen && event.key === "ArrowUp") {
                    event.preventDefault();
                    setActiveSuggestionIndex((current) => Math.max(0, current - 1));
                    return;
                  }
                  if (suggestionsOpen && event.key === "Escape") {
                    event.preventDefault();
                    setSuggestionsOpen(false);
                    return;
                  }
                  if (suggestionsOpen && event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    const selected = suggestions[activeSuggestionIndex];
                    if (selected) selectSuggestion(selected);
                    return;
                  }
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
              />
            </PopoverAnchor>
            <PopoverContent
              side="top"
              align="start"
              sideOffset={10}
              className="w-[min(480px,calc(100vw-32px))] p-0"
              onOpenAutoFocus={(event) => event.preventDefault()}
            >
              <Command shouldFilter={false}>
                <CommandList id={suggestionsListId}>
                  <CommandGroup heading="Add to message">
                    {canBrowseLibrary ? (
                      <CommandItem
                        onSelect={() => {
                          setSuggestionsOpen(false);
                          setLibraryBrowserOpen(true);
                        }}
                      >
                        <LibraryBig />
                        <span>
                          <span className="block">Browse Library</span>
                          <span className="block text-xs text-muted-foreground">
                            Select one or more shared items
                          </span>
                        </span>
                      </CommandItem>
                    ) : null}
                    {canUploadAttachments ? (
                      <CommandItem
                        onSelect={() => {
                          setSuggestionsOpen(false);
                          setAttachmentPickerOpen(true);
                        }}
                      >
                        <Paperclip />
                        <span>
                          <span className="block">Upload files</span>
                          <span className="block text-xs text-muted-foreground">
                            Choose with Misty’s file picker
                          </span>
                        </span>
                      </CommandItem>
                    ) : null}
                  </CommandGroup>
                  <CommandSeparator />
                  <CommandGroup heading="Suggestions">
                    {suggestions.map((suggestion, index) => (
                      <CommandItem
                        id={`${suggestionsListId}-option-${index}`}
                        key={`${suggestion.kind}:${suggestion.id}`}
                        aria-selected={index === activeSuggestionIndex}
                        className={index === activeSuggestionIndex ? "bg-accent" : undefined}
                        value={`${suggestion.kind}:${suggestion.id}`}
                        onMouseEnter={() => setActiveSuggestionIndex(index)}
                        onSelect={() => selectSuggestion(suggestion)}
                      >
                        {suggestion.kind === "member" ? (
                          <Users />
                        ) : suggestion.kind === "agent" ? (
                          <Sparkles />
                        ) : (
                          <LibraryBig />
                        )}
                        <span className="min-w-0">
                          <span className="block truncate">{suggestion.label}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {suggestion.detail}
                          </span>
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                  {!suggestionsLoading && !suggestionsError && suggestions.length === 0 ? (
                    <CommandEmpty>No matching people, Agents, or Library items.</CommandEmpty>
                  ) : null}
                  {suggestionsLoading ? (
                    <p className="p-3 text-sm text-muted-foreground">Loading Library…</p>
                  ) : null}
                  {suggestionsError ? (
                    <p className="p-3 text-sm text-destructive">Library: {suggestionsError}</p>
                  ) : null}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          {pendingAttachments.length > 0 || selectedLibraryIds.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 px-2 pb-2">
              {pendingAttachments.map((attachment) => (
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-7"
                  type="button"
                  key={attachment.id}
                  onClick={() =>
                    setPendingAttachments((current) =>
                      current.filter((item) => item.id !== attachment.id),
                    )
                  }
                >
                  {attachment.display_name}
                  <X />
                </Button>
              ))}
              {selectedLibraryIds.map((id) => (
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-7"
                  type="button"
                  key={id}
                  onClick={() =>
                    setSelectedLibraryIds((current) => current.filter((item) => item !== id))
                  }
                >
                  <LibraryBig />
                  {libraryItems.find((item) => item.id === id)?.display_name ?? "Library item"}
                  <X />
                </Button>
              ))}
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-2 px-1">
            <div className="flex items-center gap-1">
              {canUploadAttachments ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  type="button"
                  disabled={
                    attachmentUploading ||
                    pendingAttachments.length + selectedLibraryIds.length >= 5
                  }
                  onClick={() => setAttachmentPickerOpen(true)}
                  aria-label="Attach files"
                >
                  <Paperclip />
                </Button>
              ) : null}
              {canBrowseLibrary ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  type="button"
                  onClick={() => setLibraryBrowserOpen(true)}
                  aria-label="Browse Space Library"
                >
                  <LibraryBig />
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs"
                type="button"
                onClick={() => {
                  setText(
                    (current) => `${current}${current && !current.endsWith(" ") ? " " : ""}@`,
                  );
                  openSuggestions("");
                }}
              >
                @ Mention
              </Button>
            </div>
            <Button
              size="icon"
              className="size-8"
              disabled={
                sending ||
                (!text.trim() && pendingAttachments.length === 0 && selectedLibraryIds.length === 0)
              }
              type="submit"
              aria-label="Send message"
            >
              <Send />
            </Button>
          </div>
        </form>
      ) : (
        <div
          className="mx-[clamp(16px,4vw,56px)] mb-4 rounded-lg bg-muted/40 px-4 py-3 text-center text-sm text-muted-foreground"
          role="status"
        >
          You can read this conversation, but you cannot send messages.
        </div>
      )}

      {canBrowseLibrary && libraryBrowserOpen ? (
        <MistyLibraryPicker
          spaceId={spaceId}
          selectedIds={selectedLibraryIds}
          maximumSelected={Math.max(0, 5 - pendingAttachments.length)}
          onCancel={() => setLibraryBrowserOpen(false)}
          onChoose={(itemIds) => {
            setSelectedLibraryIds(itemIds);
            setLibraryBrowserOpen(false);
          }}
        />
      ) : null}
      {canUploadAttachments && attachmentPickerOpen ? (
        <MistyFilePicker
          mode="file"
          multiple
          title="Attach files to this chat"
          onCancel={() => setAttachmentPickerOpen(false)}
          onSelect={(path) => {
            setAttachmentPickerOpen(false);
            void uploadAttachments([path]);
          }}
          onSelectMany={(paths) => {
            setAttachmentPickerOpen(false);
            void uploadAttachments(paths);
          }}
        />
      ) : null}
      <DeleteMessageDialog
        open={Boolean(messageToDelete)}
        onOpenChange={(open) => {
          if (!open) setMessageToDelete(null);
        }}
        onConfirm={() => {
          void removeMessage();
        }}
      />
    </div>
  );
}
