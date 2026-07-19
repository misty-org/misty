import { Fragment, createContext, useContext, useEffect, useMemo, useRef, useState, type Dispatch, type FormEvent, type MouseEvent as ReactMouseEvent, type RefObject, type SetStateAction } from "react";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Bot,
  Check,
  ClipboardCopy,
  Copy,
  ChevronLeft,
  ChevronRight,
  EyeOff,
  EllipsisVertical,
  File,
  Folder,
  History,
  Image as ImageIcon,
  BookOpenText as LibraryIcon,
  Music2,
  Map as MapIcon,
  MapPin,
  MessageSquare,
  MessagesSquare,
  Paperclip,
  Pause,
  Pencil,
  Pin,
  Play,
  Plus,
  Reply,
  RotateCw,
  Search,
  Send,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Sparkles,
  Star,
  Trash2,
  Upload,
  Users,
  Video,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useAuth } from "../../auth/AuthContext";
import { confirmAction } from "../../shared/confirmAction";
import { useDialogFocus } from "../../shared/hooks/useDialogFocus";
import { buildMessageSpans, useSpacesStore } from "../../stores/useSpacesStore";
import { mergeSpaceMessages } from "../../stores/spaceMessageSpans";
import { useSetupStore } from "../../stores/useSetupStore";
import { MistyFilePicker } from "../../components/MistyFilePicker/MistyFilePicker";
import { SpaceRequestError, spacesApi } from "../../spaces/api";
import type { BulkLibraryItemAction, BulkLibraryItemOptions, LibraryAlbum, LibraryAlbumFolder, LibraryAssetStack, LibraryDiscovery, LibraryDiscoveryGroup, LibraryEditDefinition, LibraryEditVersion, LibraryGroup, LibraryImportHistoryItem, LibraryIntelligencePolicy, LibraryItemQuery, LibraryMapPoint, LibraryPerson, LibraryPinnedCollection, LibrarySearchFacets, LibrarySharedReference, MessageAttachment, MessageSpan, SpaceLibraryItem, SpaceMember, SpaceMessage, SpaceNode, SpaceStorageUsage, SpaceStudioResource } from "../../spaces/types";
import { MistyLibraryPicker } from "./components/MistyLibraryPicker";
import { SpaceLibraryEmptyState, SpaceLibraryHeader } from "./components/SpaceLibraryChrome";
import { LibraryItemContextMenu, type LibraryItemMenuState } from "./components/LibraryItemContextMenu";
import type { SpaceStudioKind } from "../Studio";
import { AgentConversationPanel } from "../Studio/AgentConversation";
import { SpaceMembers } from "./components/SpaceMembers";
import { SpaceSettings } from "./components/SpaceSettings";
import { compareLibraryItems, formatBytes, formatTime, libraryDateGroupLabel, libraryFacetPrefix } from "./libraryFormat";
import { useSpaceConversationChat } from "./useSpaceConversationChat";
import { EmbeddedUniversalPreview } from "../Files/components/GlobalPreview";
import { libraryItemThumbnailEligible } from "./libraryThumbnail";
import { GlobalImageEditor } from "../../components/GlobalImageEditor";
import { AgentCenter } from "../Agents/AgentCenter";
import { SpaceTasksCalendar } from "./SpaceTasksCalendar";
import { copyBlobFilesToClipboard, copyLibraryItemsToClipboard } from "../../spaces/libraryClipboard";
export { default, PersonalSpaceRedirect } from "./components/SpacesShell";
type LibraryCollectionKind = "recent" | "months" | "years" | "recent-days" | "utility" | "collections" | "favorites" | "hidden" | "deleted" | "people" | "albums" | "groups" | "memory" | "trip" | "map" | "duplicate" | "shared" | "imports";
const libraryCollectionKinds = new Set<LibraryCollectionKind>(["recent", "months", "years", "recent-days", "utility", "collections", "favorites", "hidden", "deleted", "people", "albums", "groups", "memory", "trip", "map", "duplicate", "shared", "imports"]);
const LibraryCanEditContext = createContext(true);
type LibraryUploadJob = { id: string; path: string; name: string; stage: "queued" | "reading" | "hashing" | "uploading" | "finalizing" | "ready" | "failed"; progress: number; error?: string };
type LibraryTextDialogState = { kind: "create-folder" | "rename-folder" | "create-group" | "rename-memory" | "rename-item" | "edit-tags"; title: string; primaryLabel: string; primaryValue: string; secondaryLabel?: string; secondaryValue?: string; itemId?: string };
export function SpaceDetail() {
  const { spaceId = "", section = "chat", studioKind = "agents" } = useParams();
  const [routeSearchParams] = useSearchParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { spaces, loading, error, loadSpace, clearError } = useSpacesStore(useShallow((state) => ({
    spaces: state.spaces,
    loading: state.loading,
    error: state.error,
    loadSpace: state.loadSpace,
    clearError: state.clearError,
  })));
  const space = spaces.find((item) => item.id === spaceId);
  useEffect(() => { if (spaceId) void loadSpace(spaceId); }, [loadSpace, spaceId, user?.id]);
  useEffect(() => {
    if (section === "files") navigate(`/spaces/${encodeURIComponent(spaceId)}/library`, { replace: true });
  }, [navigate, section, spaceId]);
  if (!space && !loading) {
    return <div className="grid h-full place-items-center text-sm text-[var(--misty-text-muted)]">This Space is unavailable.</div>;
  }
  return (
    <div className="relative h-full min-h-0">
      {error ? <button className="absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded-lg border border-red-400/30 bg-red-950/80 px-3 py-2 text-xs text-red-100" type="button" onClick={clearError}>{error}</button> : null}
      {section === "library" || section === "files" ? space?.permissions?.["library.view"] === false ? <SpacePermissionDenied title="Library access required" detail="You do not have permission to view this Space's Library."/> : <SpaceLibrary key={`library:${spaceId}`} spaceId={spaceId} /> : <div className="relative h-full min-h-0">{section === "studio" ? <Navigate to={`/spaces/${encodeURIComponent(spaceId)}/agents/studio/${normalizeStudioKind(studioKind)}${routeSearchParams.size ? `?${routeSearchParams}` : ""}`} replace/> : section === "agents" ? space?.permissions?.["agents.run"] === false && space?.permissions?.["studio.view"] === false ? <SpacePermissionDenied title="Agent access required" detail="Ask a Space owner to grant Agent or Studio access."/> : <AgentCenter key={`agents:${spaceId}:${studioKind}`} spaceId={spaceId} spaceName={space?.name ?? "This Space"} canRun={space?.permissions?.["agents.run"] !== false} canViewStudio={space?.permissions?.["studio.view"] !== false}/> : section === "tasks" ? space?.permissions?.["tasks.view"] === false ? <SpacePermissionDenied title="Task access required" detail="Ask a Space owner to grant task access."/> : <SpaceTasksCalendar key={`tasks:${spaceId}`} spaceId={spaceId} canManage={space?.permissions?.["tasks.manage"] !== false} canManageIntegrations={space?.permissions?.["integrations.manage"] !== false}/> : section === "members" ? <SpaceMembers key={`members:${spaceId}`} spaceId={spaceId} /> : section === "settings" ? <SpaceSettings key={`settings:${spaceId}:${studioKind}`} spaceId={spaceId} section={studioKind}/> : space?.permissions?.["messages.read"] === false ? <div className="grid h-full place-items-center px-6 text-center"><section className="max-w-sm rounded-2xl border border-[var(--misty-border-soft)] bg-[var(--misty-app-panel-bg,var(--misty-app-page-bg,var(--misty-bg)))] p-6"><h2 className="m-0 text-base font-semibold">Chat access required</h2><p className="mb-0 mt-2 text-sm leading-relaxed text-[var(--misty-text-muted)]">You do not have permission to read this Space's messages.</p></section></div> : <SpaceChat key={`chat:${spaceId}`} spaceId={spaceId} />}</div>}
    </div>
  );
}
function SpacePermissionDenied({ title, detail }: { title: string; detail: string }) {
  return <div className="grid h-full min-h-0 place-items-center px-6 text-center"><section className="max-w-sm rounded-2xl border border-[var(--misty-border-soft)] bg-[var(--misty-app-panel-bg,var(--misty-app-page-bg,var(--misty-bg)))] p-6"><h2 className="m-0 text-base font-semibold">{title}</h2><p className="mb-0 mt-2 text-sm leading-relaxed text-[var(--misty-text-muted)]">{detail}</p></section></div>;
}
function normalizeStudioKind(value: string): SpaceStudioKind { return value === "workflows" ? "workflows" : "agents"; }
type ChatComposerSuggestion = { kind: "member"; id: string; label: string; detail: string } | { kind: "agent"; id: string; label: string; detail: string } | { kind: "library"; id: string; label: string; detail: string; item: SpaceLibraryItem };
function SpaceChat({ spaceId }: { spaceId: string }) {
  const navigate = useNavigate();
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
  const [searchParams] = useSearchParams();
  const conversationId = searchParams.get("conversation") ?? "", agentId = searchParams.get("agentId") ?? "", agentConversationId = searchParams.get("agentConversationId") ?? "";
  const endRef = useRef<HTMLDivElement | null>(null);
  const [text, setText] = useState("");
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [selectedLibraryIds, setSelectedLibraryIds] = useState<string[]>([]);
  const [pendingAttachments, setPendingAttachments] = useState<MessageAttachment[]>([]);
  const [libraryItems, setLibraryItems] = useState<SpaceLibraryItem[]>([]);
  const [libraryPickerOpen, setLibraryPickerOpen] = useState(false);
  const [libraryPickerLoading, setLibraryPickerLoading] = useState(false);
  const [libraryPickerError, setLibraryPickerError] = useState("");
  const [libraryPickerQuery, setLibraryPickerQuery] = useState("");
  const [libraryPickerActiveIndex, setLibraryPickerActiveIndex] = useState(0);
  const [libraryBrowserOpen, setLibraryBrowserOpen] = useState(false);
  const [attachmentPickerOpen, setAttachmentPickerOpen] = useState(false);
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  const [replyToMessageId, setReplyToMessageId] = useState("");
  const [editingMessageId, setEditingMessageId] = useState("");
  const [editingText, setEditingText] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const { conversations: groupConversations, messages: groupMessages, setMessages: setGroupMessages, loading: groupLoading, error: groupChatError, setError: setGroupChatError } = useSpaceConversationChat(spaceId, conversationId, permissions?.["messages.read"] !== false);
  const { messagesBySpace, membersBySpace, agentsBySpace, nodesBySpace, sending, sendMessage, updateMessage, deleteMessage, markRead, loadMessages, loadChatAgents, openNode } = useSpacesStore(useShallow((state) => ({
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
  })));
  const defaultMessages = messagesBySpace[spaceId] ?? emptyMessages;
  const allMembers = membersBySpace[spaceId] ?? emptyMembers;
  const agents = agentsBySpace[spaceId] ?? emptyStudioResources;
  const directAgent = agents.find((agent) => agent.id === agentId), activeConversation = groupConversations.find((conversation) => conversation.id === conversationId);
  const allowedMemberIds = useMemo(() => new Set(activeConversation?.members.map((member) => member.user_id) ?? []), [activeConversation]), members = conversationId ? allMembers.filter((member) => allowedMemberIds.has(member.user_id)) : allMembers;
  const messages = conversationId ? groupMessages : defaultMessages;
  const allNodes = nodesBySpace[spaceId] ?? emptyNodes;
  const nodes = useMemo(() => allNodes.filter((node) => node.kind === "link"), [allNodes]);
  const availableLibraryItems = useMemo(() => {
    const query = libraryPickerQuery.trim().toLocaleLowerCase();
    return libraryItems.filter((item) => {
      if (selectedLibraryIds.includes(item.id)) return false;
      if (!query || query === "library") return true;
      return [item.display_name, item.file.original_filename, item.tags.join(" ")].join(" ").toLocaleLowerCase().includes(query);
    }).slice(0, 24);
  }, [libraryItems, libraryPickerQuery, selectedLibraryIds]);
  const composerSuggestions = useMemo<ChatComposerSuggestion[]>(() => {
    const query = libraryPickerQuery.trim().toLocaleLowerCase();
    const mentionSuggestions: ChatComposerSuggestion[] = [
      ...members.filter((member) => member.user_id !== user?.id).map((member) => ({ kind: "member" as const, id: member.user_id, label: member.name, detail: member.email })),
      ...(canRunAgents ? agents.filter((agent) => agent.enabled).map((agent) => ({ kind: "agent" as const, id: agent.id, label: agent.name, detail: agent.description || "Shared Agent" })) : []),
    ].filter((item) => !query || item.label.toLocaleLowerCase().includes(query) || item.detail.toLocaleLowerCase().includes(query));
    const librarySuggestions: ChatComposerSuggestion[] = canBrowseLibrary && pendingAttachments.length + selectedLibraryIds.length < 5
      ? availableLibraryItems.map((item) => ({ kind: "library" as const, id: item.id, label: item.display_name, detail: item.file.original_filename, item }))
      : [];
    return [...mentionSuggestions, ...librarySuggestions].slice(0, 24);
  }, [agents, availableLibraryItems, canBrowseLibrary, canRunAgents, libraryPickerQuery, members, pendingAttachments.length, selectedLibraryIds.length, user?.id]);
  useEffect(() => {
    setText("");
    setSelectedFileIds([]);
    setSelectedLibraryIds([]);
    setPendingAttachments([]);
    setLibraryPickerOpen(false);
    setLibraryBrowserOpen(false);
    setAttachmentPickerOpen(false);
    setReplyToMessageId("");
    setEditingMessageId("");
    setEditingText("");
    if (canRunAgents) void loadChatAgents(spaceId);
    if (permissions?.["library.view"] === false) {
      setLibraryItems([]);
      setLibraryPickerLoading(false);
      setLibraryPickerError("");
    } else {
      setLibraryPickerLoading(true);
      setLibraryPickerError("");
      void spacesApi.libraryItems(spaceId).then((result) => setLibraryItems(result.items)).catch((error: unknown) => {
        setLibraryItems([]);
        setLibraryPickerError(error instanceof Error ? error.message : "Library items could not be loaded.");
      }).finally(() => setLibraryPickerLoading(false));
    }
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
    if (!canWriteMessages || !value && pendingAttachments.length === 0 && selectedLibraryIds.length === 0) return;
    try {
      if (conversationId) { const response = await spacesApi.sendConversationMessage(spaceId, conversationId, buildMessageSpans(value, members, agents), selectedFileIds, pendingAttachments.map((item) => item.id), selectedLibraryIds, replyToMessageId); setGroupMessages((current) => mergeSpaceMessages(current, [response.message, ...response.agent_replies])); }
      else await sendMessage(spaceId, value, selectedFileIds, pendingAttachments.map((item) => item.id), selectedLibraryIds, replyToMessageId);
      setText(""); setSelectedFileIds([]); setSelectedLibraryIds([]); setPendingAttachments([]); setReplyToMessageId("");
      setLibraryPickerOpen(false);
    } catch (reason) { if (conversationId) setGroupChatError(reason instanceof Error ? reason.message : "The group message could not be sent."); }
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
  const openLibraryPicker = (query = "") => {
    if (!canWriteMessages) return;
    setLibraryPickerOpen(true);
    setLibraryPickerQuery(query);
    setLibraryPickerActiveIndex(0);
    if (!canBrowseLibrary) {
      setLibraryPickerLoading(false);
      setLibraryPickerError("");
      return;
    }
    setLibraryPickerLoading(true);
    setLibraryPickerError("");
    void spacesApi.libraryItems(spaceId).then((result) => setLibraryItems(result.items)).catch((error: unknown) => {
      setLibraryPickerError(error instanceof Error ? error.message : "Library items could not be loaded.");
    }).finally(() => setLibraryPickerLoading(false));
  };
  const onComposerChange = (value: string) => {
    if (!canWriteMessages) return;
    if (/(^|\s)@files\s*$/i.test(value)) {
      setText(value.replace(/(^|\s)@files\s*$/i, "$1"));
      setLibraryPickerOpen(false);
      if (canUploadAttachments && pendingAttachments.length + selectedLibraryIds.length < 5) setAttachmentPickerOpen(true);
      return;
    }
    if (/(^|\s)@library\s*$/i.test(value)) {
      setText(value.replace(/(^|\s)@library\s*$/i, "$1"));
      setLibraryPickerOpen(false);
      if (canBrowseLibrary) setLibraryBrowserOpen(true);
      return;
    }
    setText(value);
    const match = value.match(/(?:^|\s)@([^\s@]*)$/);
    if (match) {
      if (!libraryPickerOpen) openLibraryPicker(match[1]);
      else {
        setLibraryPickerQuery(match[1]);
        setLibraryPickerActiveIndex(0);
      }
    } else {
      setLibraryPickerOpen(false);
      setLibraryPickerQuery("");
    }
  };
  const selectLibraryItem = (item: SpaceLibraryItem) => {
    if (!canBrowseLibrary || pendingAttachments.length + selectedLibraryIds.length >= 5) return;
    setSelectedLibraryIds((current) => current.includes(item.id) ? current : [...current, item.id]);
    setText((current) => current.replace(/(^|\s)@[^\s@]*$/, "$1"));
    setLibraryPickerOpen(false);
    setLibraryPickerQuery("");
  };
  const selectComposerSuggestion = (suggestion: ChatComposerSuggestion) => {
    if (suggestion.kind === "library") {
      selectLibraryItem(suggestion.item);
      return;
    }
    setText((current) => current.replace(/(^|\s)@[^\s@]*$/, `$1@${suggestion.label} `));
    setLibraryPickerOpen(false);
    setLibraryPickerQuery("");
  };
  const beginEditing = (message: SpaceMessage) => {
    if (!canWriteMessages) return;
    setEditingMessageId(message.id);
    setEditingText(message.content.map((span) => span.type === "text" ? span.text : `@${span.label}`).join(""));
  };
  const cancelEditing = (messageId: string) => {
    setEditingMessageId("");
    setEditingText("");
    window.setTimeout(() => {
      document.querySelector<HTMLButtonElement>(`#message-${CSS.escape(messageId)} button[aria-label="Edit message"]`)?.focus();
    }, 0);
  };
  const saveEditedMessage = async (event: FormEvent, message: SpaceMessage) => {
    event.preventDefault();
    const value = editingText.trim();
    if (!canWriteMessages || !value || editSaving) return;
    setEditSaving(true);
    try {
      if (conversationId) { const saved = await spacesApi.updateConversationMessage(spaceId, conversationId, message.id, buildMessageSpans(value, members, agents), message.file_node_ids); setGroupMessages((current) => mergeSpaceMessages(current, [saved])); }
      else await updateMessage(spaceId, message.id, value, message.file_node_ids);
      cancelEditing(message.id);
    } catch { /* the page-level error renders the server response */ }
    finally { setEditSaving(false); }
  };
  if (agentId) return directAgent ? <AgentConversationPanel agent={directAgent} conversationId={agentConversationId || undefined} embedded onClose={() => navigate(`/spaces/${encodeURIComponent(spaceId)}/chat`)}/> : <div className="grid h-full place-items-center px-6 text-center"><div><Bot className="mx-auto text-[var(--misty-text-subtle)]"/><h2 className="mb-1 mt-3 text-base">Agent chat unavailable</h2><p className="m-0 text-xs text-[var(--misty-text-subtle)]">This Space Agent is disabled, missing, or you no longer have permission to run it.</p></div></div>;
  return (
    <div className={`grid h-full min-h-0 ${conversationId ? "grid-rows-[auto_minmax(0,1fr)_auto]" : "grid-rows-[minmax(0,1fr)_auto]"}`}>
      {conversationId ? <header className="flex min-h-12 items-center justify-between border-b border-[var(--misty-divider-subtle)] px-6"><div className="min-w-0"><h2 className="m-0 truncate text-sm font-semibold">{activeConversation?.title ?? "Group chat"}</h2><p className="mb-0 mt-0.5 truncate text-[9px] text-[var(--misty-text-subtle)]">{activeConversation?.members.map((member) => member.user_id === user?.id ? "You" : member.name).join(", ") || "Selected Space members"}</p></div><span className="inline-flex items-center gap-1 rounded-full bg-violet-500/10 px-2 py-1 text-[9px] text-violet-200"><Users size={11}/>Group</span></header> : null}
      <div className="min-h-0 overflow-auto px-[clamp(24px,6vw,88px)] py-6">
        {groupChatError ? <div className="mb-4 rounded-xl border border-red-400/20 bg-red-950/20 px-3 py-2 text-xs text-red-200" role="alert">{groupChatError}</div> : null}
        {groupLoading ? <div className="grid h-full place-items-center text-xs text-[var(--misty-text-subtle)]">Loading group chat…</div> : messages.length === 0 ? (
          <div className="grid h-full place-items-center text-center">
            <div><span className="mx-auto grid size-12 place-items-center rounded-2xl bg-[var(--misty-surface-2)]"><MessageSquare size={22} /></span><h3 className="mb-1 mt-3">Start the conversation</h3><p className="m-0 text-sm text-[var(--misty-text-subtle)]">Mention a teammate or shared Agent with @name.</p></div>
          </div>
        ) : messages.map((message) => (
          <article className="group mb-5 grid grid-cols-[40px_minmax(0,1fr)_auto] gap-3" id={`message-${message.id}`} key={message.id}>
            <span className="grid size-10 place-items-center rounded-full bg-[var(--misty-surface-3)] text-xs font-bold">{message.sender_kind === "agent" ? "AI" : message.sender_name.slice(0, 2).toUpperCase()}</span>
            <div className="min-w-0">
              <div className="flex items-baseline gap-2"><strong className="text-sm">{message.sender_name}{message.sender_kind === "person" && message.sender_user_id === user?.id ? " (me)" : ""}</strong>{message.sender_kind === "agent" ? <span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[9px] font-semibold capitalize text-violet-300">Agent</span> : null}<time className="text-[10px] text-[var(--misty-text-subtle)]">{formatTime(message.created_at)}</time>{message.edited_at ? <span className="text-[10px] text-[var(--misty-text-subtle)]">Edited</span> : null}</div>
              {message.reply_to_message_id ? <button className="mt-1 block max-w-full truncate border-0 border-l-2 border-[var(--misty-primary)] bg-transparent pl-2 text-left text-[10px] text-[var(--misty-text-subtle)]" type="button" onClick={() => document.getElementById(`message-${message.reply_to_message_id}`)?.scrollIntoView({ block: "center" })}>Replying to {messages.find((item) => item.id === message.reply_to_message_id)?.sender_name ?? "a message"}</button> : null}
              {editingMessageId === message.id ? (
                <form className="mt-2 rounded-xl border border-[var(--misty-border-strong)] bg-[var(--misty-app-panel-bg,var(--misty-app-page-bg,var(--misty-bg)))] p-2" onSubmit={(event) => void saveEditedMessage(event, message)}>
                  <textarea className="min-h-[72px] w-full resize-y border-0 bg-transparent px-2 py-1 text-sm leading-relaxed text-[var(--misty-text)] outline-none" autoFocus maxLength={4000} value={editingText} onChange={(event) => setEditingText(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape" && !editSaving) cancelEditing(message.id); }} aria-label="Edit message" />
                  <div className="mt-1 flex justify-end gap-2"><button className={smallButtonClass} type="button" disabled={editSaving} onClick={() => cancelEditing(message.id)}>Cancel</button><button className={primaryButtonClass} type="submit" disabled={editSaving || !editingText.trim()}>{editSaving ? "Saving…" : "Save"}</button></div>
                </form>
              ) : <p className="m-0 mt-1 whitespace-pre-wrap text-sm leading-relaxed text-[var(--misty-text-muted)]">{message.content.map((span, index) => <MessageContent key={index} span={span} />)}</p>}
              {message.file_node_ids.length > 0 ? <div className="mt-2 flex flex-wrap gap-1.5">{message.file_node_ids.map((nodeId) => { const node = nodes.find((item) => item.id === nodeId); return <button className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] px-2 py-1 text-[10px] text-sky-200" type="button" key={nodeId} onClick={() => void openNode(spaceId, nodeId)}><Paperclip size={11}/>{node?.display_name ?? "Drive file"}</button>; })}</div> : null}
              {(message.library_item_ids?.length ?? 0) > 0 ? <div className="mt-2 flex flex-wrap gap-1.5">{message.library_item_ids?.map((itemId) => { const item = libraryItems.find((candidate) => candidate.id === itemId); return <button className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--misty-border-soft)] bg-violet-500/10 px-2 py-1 text-[10px] text-violet-200 disabled:cursor-not-allowed disabled:opacity-55" type="button" key={itemId} disabled={!item || !canCopyLibrary} title={canCopyLibrary ? "Copy to clipboard" : "Copy permission required"} onClick={() => { if (item && canCopyLibrary) void copyLibraryItemsToClipboard(spaceId, [item]).catch((error) => setGroupChatError(error instanceof Error ? error.message : "The Library item could not be copied.")); }}><LibraryIcon size={11}/>{item?.display_name ?? "Unavailable Library item"}</button>; })}</div> : null}
              {(message.attachments?.length ?? 0) > 0 ? <div className="mt-2 flex flex-wrap gap-1.5">{message.attachments?.map((attachment) => <span className="inline-flex items-center gap-1 rounded-lg border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] p-1 pl-2 text-[10px]" key={attachment.id}><Paperclip size={11}/><button className="border-0 bg-transparent text-sky-200" type="button" onClick={() => void spacesApi.downloadAttachment(spaceId, attachment.id, attachment.display_name)}>{attachment.display_name}</button>{attachment.promoted_item_id ? <span className="px-1 text-[9px] text-emerald-300">In Library</span> : canAddToLibrary ? <button className="rounded-md border-0 bg-[var(--misty-surface-3)] px-1.5 py-0.5 text-[9px] text-[var(--misty-text-muted)]" type="button" onClick={() => void spacesApi.promoteAttachment(spaceId, attachment.id).then((item) => { setLibraryItems((current) => [...current.filter((candidate) => candidate.id !== item.id), item]); void loadMessages(spaceId); })}>Add to Library</button> : null}</span>)}</div> : null}
            </div>
            {canWriteMessages ? <div className="pointer-events-none flex gap-1 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"><button className={messageActionButtonClass} type="button" onClick={() => setReplyToMessageId(message.id)} aria-label="Reply" title="Reply"><Reply size={14}/></button>{message.sender_kind === "person" && message.sender_user_id === user?.id ? <button className={messageActionButtonClass} type="button" onClick={() => beginEditing(message)} aria-label="Edit message" title="Edit message"><Pencil size={14}/></button> : null}{(message.sender_user_id === user?.id || activeSpace?.role === "owner") ? <button className={messageActionButtonClass} type="button" onClick={() => void confirmAction("Remove this message?").then(async (confirmed) => { if (!confirmed) return; if (conversationId) { await spacesApi.deleteConversationMessage(spaceId, conversationId, message.id); setGroupMessages((current) => current.filter((item) => item.id !== message.id)); } else await deleteMessage(spaceId, message.id); })} aria-label="Remove message" title="Remove message"><Trash2 size={14} /></button> : null}</div> : null}
          </article>
        ))}
        <div ref={endRef} />
      </div>
      {canWriteMessages ? <form className="relative mx-[clamp(20px,5vw,72px)] mb-5 rounded-2xl border border-[var(--misty-border-strong)] bg-[var(--misty-app-panel-bg,var(--misty-app-page-bg,var(--misty-bg)))] p-2" onSubmit={(event) => void submit(event)}>
        {replyToMessageId ? <div className="mx-2 mt-1 flex items-center justify-between rounded-lg border-l-2 border-[var(--misty-primary)] bg-[var(--misty-surface-2)] px-3 py-1.5 text-[10px] text-[var(--misty-text-muted)]"><span>Replying to {messages.find((item) => item.id === replyToMessageId)?.sender_name ?? "message"}</span><button className="border-0 bg-transparent text-[var(--misty-text-subtle)]" type="button" onClick={() => setReplyToMessageId("")} aria-label="Cancel reply" title="Cancel reply"><X size={12}/></button></div> : null}
        <textarea className="min-h-[54px] w-full resize-none border-0 bg-transparent px-3 py-2 text-sm text-[var(--misty-text)] outline-none" aria-label={conversationId ? "Message this group" : "Message this Space"} maxLength={4000} placeholder={conversationId ? "Message this group — type @ to mention or add" : "Message this Space — type @ to mention or add"} value={text} onChange={(event) => onComposerChange(event.target.value)} onKeyDown={(event) => {
          if (libraryPickerOpen && event.key === "ArrowDown") { event.preventDefault(); setLibraryPickerActiveIndex((current) => Math.min(current + 1, Math.max(0, composerSuggestions.length - 1))); return; }
          if (libraryPickerOpen && event.key === "ArrowUp") { event.preventDefault(); setLibraryPickerActiveIndex((current) => Math.max(0, current - 1)); return; }
          if (libraryPickerOpen && event.key === "Escape") { event.preventDefault(); setLibraryPickerOpen(false); return; }
          if (libraryPickerOpen && event.key === "Enter" && !event.shiftKey) { event.preventDefault(); const selected = composerSuggestions[libraryPickerActiveIndex]; if (selected) selectComposerSuggestion(selected); return; }
          if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
        }} />
        <div className="flex items-center justify-between gap-3 px-2 pb-1">
          <div className="flex min-w-0 items-center gap-1 overflow-auto">
            {canUploadAttachments ? <button className="grid size-7 shrink-0 place-items-center rounded-lg border-0 bg-[var(--misty-surface-2)] text-[var(--misty-text-muted)]" type="button" disabled={attachmentUploading || pendingAttachments.length + selectedLibraryIds.length >= 5} onClick={() => setAttachmentPickerOpen(true)} aria-label="Attach files" title="Attach files with Misty's picker"><Paperclip size={13}/></button> : null}
            {canBrowseLibrary ? <button className="grid size-7 shrink-0 place-items-center rounded-lg border-0 bg-[var(--misty-surface-2)] text-[var(--misty-text-muted)]" type="button" onClick={() => { setLibraryPickerOpen(false); setLibraryBrowserOpen(true); }} aria-label="Browse Space Library" title="Browse this Space's Library"><LibraryIcon size={13}/></button> : null}
            {[...members.filter((member) => member.user_id !== user?.id), ...(canRunAgents ? agents.filter((agent) => agent.enabled) : [])].slice(0, 6).map((item) => <button className="whitespace-nowrap rounded-md border-0 bg-[var(--misty-surface-2)] px-2 py-1 text-[10px] text-[var(--misty-text-muted)]" type="button" key={"user_id" in item ? item.user_id : item.id} onClick={() => setText((current) => `${current}${current && !current.endsWith(" ") ? " " : ""}@${item.name} `)}>@{item.name}</button>)}
          </div>
          <button className="grid size-8 shrink-0 place-items-center rounded-xl border-0 bg-[var(--misty-primary)] text-[var(--misty-primary-contrast)] disabled:opacity-50" disabled={sending || (!text.trim() && pendingAttachments.length === 0 && selectedLibraryIds.length === 0)} type="submit" aria-label="Send message" title="Send message"><Send size={15} /></button>
        </div>
        {libraryPickerOpen ? <div className="absolute bottom-[calc(100%+8px)] left-0 z-30 flex max-h-[min(420px,55vh)] w-full flex-col overflow-hidden rounded-2xl border border-[var(--misty-border-strong)] bg-[var(--misty-app-panel-bg,var(--misty-app-page-bg,var(--misty-bg)))] shadow-2xl" role="listbox" aria-label="Mention or add to message">
          <div className="border-b border-[var(--misty-border-soft)] px-4 py-3"><p className="m-0 text-[10px] font-semibold capitalize text-[var(--misty-text-subtle)]">Mention Or Add</p>{libraryPickerQuery ? <p className="mb-0 mt-1 truncate text-xs text-[var(--misty-text-muted)]">Matching “{libraryPickerQuery}”</p> : null}</div>
          <div className="overflow-y-auto p-1.5">
            {canBrowseLibrary ? <button className="mb-1 flex w-full items-center gap-3 rounded-xl border-0 bg-transparent px-3 py-2.5 text-left text-sm text-[var(--misty-text)] hover:bg-[var(--misty-surface-2)] disabled:opacity-40" type="button" disabled={pendingAttachments.length + selectedLibraryIds.length >= 5} onClick={() => { setLibraryPickerOpen(false); setLibraryBrowserOpen(true); }}><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--misty-surface-2)]"><LibraryIcon size={15}/></span><span><span className="block font-medium">Browse Library</span><span className="mt-0.5 block text-[10px] text-[var(--misty-text-subtle)]">Search, filter, and select multiple items</span></span></button> : null}
            {canUploadAttachments ? <button className="mb-1 flex w-full items-center gap-3 rounded-xl border-0 bg-transparent px-3 py-2.5 text-left text-sm text-[var(--misty-text)] hover:bg-[var(--misty-surface-2)] disabled:opacity-40" type="button" disabled={attachmentUploading || pendingAttachments.length + selectedLibraryIds.length >= 5} onClick={() => { setLibraryPickerOpen(false); setAttachmentPickerOpen(true); }}><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--misty-surface-2)]"><Paperclip size={15}/></span><span><span className="block font-medium">Upload files</span><span className="mt-0.5 block text-[10px] text-[var(--misty-text-subtle)]">Choose with Misty’s file picker</span></span></button> : null}
            {composerSuggestions.length > 0 ? <><p className="mb-1 mt-2 px-3 text-[10px] font-semibold capitalize text-[var(--misty-text-subtle)]">Suggestions</p>{composerSuggestions.map((suggestion, suggestionIndex) => <button className={`flex w-full items-center gap-3 rounded-xl border-0 px-3 py-2.5 text-left text-sm ${suggestionIndex === libraryPickerActiveIndex ? "bg-[var(--misty-surface-2)] text-[var(--misty-text)]" : "bg-transparent text-[var(--misty-text-muted)] hover:bg-[var(--misty-surface-2)]"}`} type="button" role="option" aria-selected={suggestionIndex === libraryPickerActiveIndex} key={`${suggestion.kind}:${suggestion.id}`} onMouseEnter={() => setLibraryPickerActiveIndex(suggestionIndex)} onClick={() => selectComposerSuggestion(suggestion)}><span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-lg bg-[var(--misty-surface-2)]">{suggestion.kind === "member" ? <Users size={15}/> : suggestion.kind === "agent" ? <Sparkles size={15}/> : <LibraryItemThumbnail spaceId={spaceId} item={suggestion.item}/>}</span><span className="min-w-0"><span className="block truncate font-medium">{suggestion.label}</span><span className="mt-0.5 block truncate text-[10px] text-[var(--misty-text-subtle)]">{suggestion.kind === "member" ? `Person · ${suggestion.detail}` : suggestion.kind === "agent" ? `Agent · ${suggestion.detail}` : `Library · ${suggestion.detail}`}</span></span></button>)}</> : !libraryPickerLoading && !libraryPickerError ? <p className="m-0 px-3 py-3 text-xs text-[var(--misty-text-subtle)]">No matching people, Agents, or Library items.</p> : null}
            {canBrowseLibrary && libraryPickerLoading ? <p className="m-0 px-3 py-3 text-xs text-[var(--misty-text-subtle)]">Loading Library…</p> : canBrowseLibrary && libraryPickerError ? <div className="px-3 py-3"><p className="m-0 text-xs text-red-200">Library: {libraryPickerError}</p><button className={`${smallButtonClass} mt-2`} type="button" onClick={() => openLibraryPicker(libraryPickerQuery)}>Retry</button></div> : null}
          </div>
        </div> : null}
        {pendingAttachments.length > 0 || selectedLibraryIds.length > 0 ? <div className="flex flex-wrap gap-1 px-2 pb-1">{pendingAttachments.map((attachment) => <button className="rounded-md border-0 bg-sky-500/10 px-2 py-1 text-[9px] text-sky-200" type="button" key={attachment.id} onClick={() => setPendingAttachments((current) => current.filter((item) => item.id !== attachment.id))}>{attachment.display_name} ×</button>)}{selectedLibraryIds.map((id) => <button className="rounded-md border-0 bg-violet-500/10 px-2 py-1 text-[9px] text-violet-200" type="button" key={id} onClick={() => setSelectedLibraryIds((current) => current.filter((item) => item !== id))}>@library {libraryItems.find((item) => item.id === id)?.display_name ?? "item"} ×</button>)}</div> : null}
      </form> : <div className="mx-[clamp(20px,5vw,72px)] mb-5 rounded-2xl border border-[var(--misty-border-soft)] bg-[var(--misty-app-panel-bg,var(--misty-app-page-bg,var(--misty-bg)))] px-4 py-3 text-center text-xs text-[var(--misty-text-muted)]" role="status">You can read this conversation, but you do not have permission to send messages.</div>}
      {canBrowseLibrary && libraryBrowserOpen ? <MistyLibraryPicker spaceId={spaceId} selectedIds={selectedLibraryIds} maximumSelected={Math.max(0, 5 - pendingAttachments.length)} onCancel={() => setLibraryBrowserOpen(false)} onChoose={(itemIds) => { setSelectedLibraryIds(itemIds); setLibraryBrowserOpen(false); }}/> : null}
      {canUploadAttachments && attachmentPickerOpen ? <MistyFilePicker mode="file" multiple title="Attach files to this chat" onCancel={() => setAttachmentPickerOpen(false)} onSelect={(path) => { setAttachmentPickerOpen(false); void uploadAttachments([path]); }} onSelectMany={(paths) => { setAttachmentPickerOpen(false); void uploadAttachments(paths); }}/> : null}
    </div>
  );
}

function MessageContent({ span }: { span: MessageSpan }) { return span.type === "text" ? <>{span.text}</> : <span className="rounded bg-violet-500/15 px-1 py-0.5 font-medium text-violet-300">@{span.label}</span>; }

function SpaceLibrary({ spaceId }: { spaceId: string }) {
  const [librarySearchParams, setLibrarySearchParams] = useSearchParams();
  const requestedCollection = librarySearchParams.get("collection");
  const requestedCollectionId = librarySearchParams.get("collectionId") ?? "";
  const activeSpace = useSpacesStore((state) => state.spaces.find((space) => space.id === spaceId));
  const permissions = activeSpace?.permissions;
  const canUploadLibrary = permissions?.["library.upload"] !== false;
  const canEditLibrary = permissions?.["library.edit"] !== false;
  const canCopyLibrary = permissions?.["library.download"] !== false;
  const [items, setItems] = useState<SpaceLibraryItem[]>([]);
  const [visibleItems, setVisibleItems] = useState<SpaceLibraryItem[]>([]);
  const [usage, setUsage] = useState<SpaceStorageUsage | null>(null);
  const [assetStacks, setAssetStacks] = useState<LibraryAssetStack[]>([]);
  const [albums, setAlbums] = useState<LibraryAlbum[]>([]);
  const [albumFolders, setAlbumFolders] = useState<LibraryAlbumFolder[]>([]);
  const [selectedAlbumFolderId, setSelectedAlbumFolderId] = useState("");
  const [groups, setGroups] = useState<LibraryGroup[]>([]);
  const [people, setPeople] = useState<LibraryPerson[]>([]);
  const [peoplePolicy, setPeoplePolicy] = useState<LibraryIntelligencePolicy | null>(null);
  const [collection, setCollection] = useState<LibraryCollectionKind>("recent");
  const [selectedCollectionId, setSelectedCollectionId] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchFacets, setSearchFacets] = useState<LibrarySearchFacets>({ total: 0, favorites: 0, hidden: 0, recently_deleted: 0, tags: [], media_types: [], years: [], albums: [], utilities: [] });
  const [discovery, setDiscovery] = useState<LibraryDiscovery>({ recent_days: [], months: [], years: [], memories: [], trips: [], duplicates: [], map_points: [] });
  const [sharedReferences, setSharedReferences] = useState<LibrarySharedReference[]>([]);
  const [outgoingReferences, setOutgoingReferences] = useState<LibrarySharedReference[]>([]);
  const [pins, setPins] = useState<LibraryPinnedCollection[]>([]);
  const [importHistory, setImportHistory] = useState<LibraryImportHistoryItem[]>([]);
  const [memoryPlaybackOpen, setMemoryPlaybackOpen] = useState(false);
  const [memoryAudioItems, setMemoryAudioItems] = useState<SpaceLibraryItem[]>([]);
  const [mediaType, setMediaType] = useState<"" | NonNullable<LibraryItemQuery["media_type"]>>("");
  const [libraryViewMode, setLibraryViewMode] = useState<"grid" | "list">("grid");
  const [sort, setSort] = useState<NonNullable<LibraryItemQuery["sort"]>>("recently-added");
  const [direction, setDirection] = useState<NonNullable<LibraryItemQuery["direction"]>>("desc");
  const [reloadKey, setReloadKey] = useState(0);
  const [nextAfter, setNextAfter] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploadJobs, setUploadJobs] = useState<LibraryUploadJob[]>([]);
  const [filePickerOpen, setFilePickerOpen] = useState(false);
  const [localError, setLocalError] = useState("");
  const [selectedItemId, setSelectedItemId] = useState("");
  const libraryViewerTriggerRef = useRef<HTMLElement | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [itemMenu, setItemMenu] = useState<LibraryItemMenuState | null>(null);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [copiedEditDefinition, setCopiedEditDefinition] = useState<LibraryEditDefinition | null>(null);
  const [sensitiveGrants, setSensitiveGrants] = useState<Partial<Record<"hidden" | "recently_deleted", { token: string; expiresAt: string }>>>({});
  const [unlockScope, setUnlockScope] = useState<"" | "hidden" | "recently_deleted">("");
  const [unlockPassword, setUnlockPassword] = useState("");
  const [unlockSaving, setUnlockSaving] = useState(false);
  const [metadataDialogAction, setMetadataDialogAction] = useState<"" | "add_tags" | "remove_tags" | "set_date" | "set_location">("");
  const [metadataTags, setMetadataTags] = useState("");
  const [metadataDate, setMetadataDate] = useState("");
  const [metadataLocationName, setMetadataLocationName] = useState("");
  const [metadataLatitude, setMetadataLatitude] = useState("");
  const [metadataLongitude, setMetadataLongitude] = useState("");
  const [albumDialogMode, setAlbumDialogMode] = useState<"" | "create" | "edit">("");
  const [albumName, setAlbumName] = useState("");
  const [albumDescription, setAlbumDescription] = useState("");
  const [albumCoverItemId, setAlbumCoverItemId] = useState("");
  const [albumSaving, setAlbumSaving] = useState(false);
  const [draggedAlbumItemId, setDraggedAlbumItemId] = useState("");
  const [personDialogMode, setPersonDialogMode] = useState<"" | "create" | "edit">("");
  const [personName, setPersonName] = useState("");
  const [personKind, setPersonKind] = useState<"person" | "pet">("person");
  const [personCoverItemId, setPersonCoverItemId] = useState("");
  const [personSaving, setPersonSaving] = useState(false);
  const [textDialog, setTextDialog] = useState<LibraryTextDialogState | null>(null);
  const [textDialogSaving, setTextDialogSaving] = useState(false);
  const [textDialogError, setTextDialogError] = useState("");
  const libraryDialogTriggerRef = useRef<HTMLElement | null>(null);
  const albumDialogFocus = useDialogFocus<HTMLFormElement>(Boolean(albumDialogMode), libraryDialogTriggerRef);
  const personDialogFocus = useDialogFocus<HTMLFormElement>(Boolean(personDialogMode), libraryDialogTriggerRef);
  const metadataDialogFocus = useDialogFocus<HTMLFormElement>(Boolean(metadataDialogAction), libraryDialogTriggerRef);
  const textDialogFocus = useDialogFocus<HTMLFormElement>(Boolean(textDialog), libraryDialogTriggerRef);
  const unlockDialogFocus = useDialogFocus<HTMLFormElement>(Boolean(unlockScope), libraryDialogTriggerRef);
  const hiddenStackMemberIDs = useMemo(() => new Set(assetStacks.flatMap((stack) => stack.members.filter((member) => member.item_id !== stack.cover_item_id).map((member) => member.item_id))), [assetStacks]);
  const displayItems = useMemo(() => visibleItems.filter((item) => !hiddenStackMemberIDs.has(item.id)), [hiddenStackMemberIDs, visibleItems]);
  const stackByItemID = useMemo(() => new Map(assetStacks.flatMap((stack) => stack.members.map((member) => [member.item_id, stack] as const))), [assetStacks]);
  const selectedItems = useMemo(() => displayItems.filter((item) => selectedItemIds.includes(item.id)), [displayItems, selectedItemIds]);
  const currentAlbum = useMemo(() => collection === "albums" && selectedCollectionId ? albums.find((album) => album.id === selectedCollectionId) ?? null : null, [albums, collection, selectedCollectionId]);
  const currentAlbumFolder = useMemo(() => albumFolders.find((folder) => folder.id === selectedAlbumFolderId) ?? null, [albumFolders, selectedAlbumFolderId]);
  const visibleAlbumFolders = useMemo(() => albumFolders.filter((folder) => (folder.parent_folder_id ?? "") === selectedAlbumFolderId), [albumFolders, selectedAlbumFolderId]);
  const visibleAlbumsForFolder = useMemo(() => albums.filter((album) => (album.folder_id ?? "") === selectedAlbumFolderId), [albums, selectedAlbumFolderId]);
  const currentGroup = useMemo(() => collection === "groups" && selectedCollectionId ? groups.find((group) => group.id === selectedCollectionId) ?? null : null, [collection, groups, selectedCollectionId]);
  const currentPerson = useMemo(() => collection === "people" && selectedCollectionId ? people.find((person) => person.id === selectedCollectionId) ?? null : null, [collection, people, selectedCollectionId]);
  const currentDiscoveryGroup = useMemo(() => collection === "memory" ? discovery.memories.find((group) => group.id === selectedCollectionId) ?? null : collection === "trip" ? discovery.trips.find((group) => group.id === selectedCollectionId) ?? null : collection === "duplicate" ? discovery.duplicates.find((group) => group.id === selectedCollectionId) ?? null : null, [collection, discovery, selectedCollectionId]);
  const currentDateGroup = useMemo(() => collection === "recent-days" ? discovery.recent_days.find((group) => group.id === selectedCollectionId) ?? null : collection === "months" ? discovery.months.find((group) => group.id === selectedCollectionId) ?? null : collection === "years" ? discovery.years.find((group) => group.id === selectedCollectionId) ?? null : null, [collection, discovery.months, discovery.recent_days, discovery.years, selectedCollectionId]);
  const currentMapPoint = useMemo(() => collection === "map" && selectedCollectionId ? discovery.map_points.find((point) => point.id === selectedCollectionId) ?? null : null, [collection, discovery.map_points, selectedCollectionId]);
  const canReorderAlbum = Boolean(canEditLibrary && currentAlbum && currentAlbum.sort_mode === "custom" && sort === "album-order" && !searchQuery && !mediaType && currentAlbum.item_count === visibleItems.length);
  const sensitiveCollectionScope = collection === "hidden" ? "hidden" : collection === "deleted" ? "recently_deleted" : "";
  const sensitiveCollectionToken = sensitiveCollectionScope ? activeSensitiveGrant(sensitiveGrants[sensitiveCollectionScope]) : "";
  const rememberLibraryDialogTrigger = () => {
    libraryDialogTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  };
  const closeSensitiveUnlock = () => {
    if (unlockSaving) return;
    setUnlockScope("");
    setUnlockPassword("");
    setLocalError("");
  };
  const showTextDialog = (dialog: LibraryTextDialogState) => {
    rememberLibraryDialogTrigger();
    setTextDialogError("");
    setTextDialog(dialog);
  };

  useEffect(() => {
    setSensitiveGrants({});
    setUnlockScope("");
    setUnlockPassword("");
  }, [spaceId]);

  useEffect(() => {
    const handleLibraryEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ space_id?: string }>).detail;
      if (detail?.space_id === spaceId) setReloadKey((current) => current + 1);
    };
    window.addEventListener("misty:space-library-event", handleLibraryEvent);
    return () => window.removeEventListener("misty:space-library-event", handleLibraryEvent);
  }, [spaceId]);

  useEffect(() => {
    if (!textDialog) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !textDialogSaving) setTextDialog(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [textDialog, textDialogSaving]);

  useEffect(() => {
    if (!albumDialogMode && !personDialogMode && !metadataDialogAction && !unlockScope) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (albumDialogMode && !albumSaving) setAlbumDialogMode("");
      else if (personDialogMode && !personSaving) setPersonDialogMode("");
      else if (metadataDialogAction && !bulkSaving) setMetadataDialogAction("");
      else if (unlockScope && !unlockSaving) closeSensitiveUnlock();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [albumDialogMode, albumSaving, bulkSaving, metadataDialogAction, personDialogMode, personSaving, unlockSaving, unlockScope]);

  useEffect(() => {
    const expirations = Object.values(sensitiveGrants).map((grant) => grant?.expiresAt ? Date.parse(grant.expiresAt) : Number.NaN).filter(Number.isFinite);
    if (expirations.length === 0) return;
    const delay = Math.max(0, Math.min(...expirations) - Date.now());
    const timer = window.setTimeout(() => setSensitiveGrants((current) => Object.fromEntries(Object.entries(current).filter(([, grant]) => activeSensitiveGrant(grant) !== "")) as typeof current), delay + 25);
    return () => window.clearTimeout(timer);
  }, [sensitiveGrants]);

  const libraryQuery = useMemo<LibraryItemQuery>(() => ({
    q: searchQuery,
    sort,
    direction,
    media_type: mediaType || undefined,
    utility: collection === "utility" && selectedCollectionId ? selectedCollectionId as LibraryItemQuery["utility"] : undefined,
    visibility: collection === "hidden" ? "hidden" : "visible",
    collection: collection === "deleted" ? "recently-deleted" : undefined,
    favorite: collection === "favorites",
    album_id: collection === "albums" && selectedCollectionId ? selectedCollectionId : undefined,
  }), [collection, direction, mediaType, searchQuery, selectedCollectionId, sort]);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearchQuery(searchInput.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    let current = true;
    const timer = window.setTimeout(() => {
      void spacesApi.libraryFacets(spaceId, libraryFacetPrefix(searchInput)).then((facets) => current && setSearchFacets(facets)).catch(() => current && setSearchFacets({ total: 0, favorites: 0, hidden: 0, recently_deleted: 0, tags: [], media_types: [], years: [], albums: [], utilities: [] }));
    }, 150);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [searchInput, spaceId]);

  useEffect(() => {
    let current = true;
    void Promise.all([spacesApi.libraryUsage(spaceId), spacesApi.albums(spaceId), spacesApi.albumFolders(spaceId).catch(() => ({ folders: [] })), spacesApi.groups(spaceId).catch(() => ({ groups: [] })), spacesApi.peoplePolicy(spaceId).catch(() => null), spacesApi.people(spaceId).catch(() => ({ people: [] })), spacesApi.libraryDiscovery(spaceId).catch(() => ({ recent_days: [], months: [], years: [], memories: [], trips: [], duplicates: [], map_points: [] })), spacesApi.sharedReferences(spaceId).catch(() => ({ references: [], outgoing: [] })), spacesApi.libraryPins(spaceId).catch(() => ({ pins: [] })), spacesApi.libraryImportHistory(spaceId).catch(() => ({ imports: [] })), spacesApi.libraryAssetStacks(spaceId).catch(() => ({ stacks: [] }))]).then(([currentUsage, albumResult, folderResult, groupResult, policyResult, peopleResult, discoveryResult, sharedResult, pinResult, importResult, stackResult]) => {
      if (!current) return;
      setUsage(currentUsage);
      setAlbums(albumResult.albums);
      setAlbumFolders(folderResult.folders);
      setGroups(groupResult.groups);
      setPeoplePolicy(policyResult);
      setPeople(peopleResult.people);
      setDiscovery(discoveryResult);
      setSharedReferences(sharedResult.references);
      setOutgoingReferences(sharedResult.outgoing);
      setPins(pinResult.pins);
      setImportHistory(importResult.imports);
      setAssetStacks(stackResult.stacks);
    }).catch((error: unknown) => current && setLocalError(error instanceof Error ? error.message : "Library could not be loaded."));
    return () => { current = false; };
  }, [reloadKey, spaceId]);

  useEffect(() => {
    let current = true;
    if (sensitiveCollectionScope && !sensitiveCollectionToken) {
      setItems([]);
      setVisibleItems([]);
      setLoading(false);
      return () => { current = false; };
    }
    if (collection === "collections" || collection === "shared" || collection === "imports" || (collection === "recent-days" || collection === "months" || collection === "years" || collection === "people" || collection === "albums" || collection === "groups" || collection === "duplicate" || collection === "map") && !selectedCollectionId) {
      setItems([]);
      setVisibleItems([]);
      setLoading(false);
      return () => { current = false; };
    }
    setLoading(true);
    setLocalError("");
    const dateDiscoveryKind = collection === "recent-days" ? "day" : collection === "months" ? "month" : collection === "years" ? "year" : null;
    const semanticSearch = collection === "recent" && Boolean(searchQuery) && !searchQuery.includes(":") && !mediaType && Boolean(peoplePolicy?.semantic_search_enabled);
    const request = semanticSearch
      ? spacesApi.semanticLibrarySearch(spaceId, searchQuery).catch(() => spacesApi.libraryItems(spaceId, libraryQuery))
      : dateDiscoveryKind
      ? spacesApi.discoveryItems(spaceId, dateDiscoveryKind, selectedCollectionId)
      : collection === "memory" || collection === "trip" || collection === "duplicate" || collection === "map"
      ? spacesApi.discoveryItems(spaceId, collection, selectedCollectionId)
      : collection === "people"
      ? spacesApi.personItems(spaceId, selectedCollectionId)
      : collection === "groups"
      ? spacesApi.groupItems(spaceId, selectedCollectionId)
      : collection === "albums" && selectedCollectionId
        ? spacesApi.albumItems(spaceId, selectedCollectionId)
        : spacesApi.libraryItems(spaceId, libraryQuery, sensitiveCollectionToken);
    void request.then((library) => {
      if (!current) return;
      let nextItems = library.items;
      if (collection === "recent-days" || collection === "months" || collection === "years" || collection === "people" || collection === "groups" || collection === "memory" || collection === "trip" || collection === "map" || collection === "duplicate" || collection === "albums" && selectedCollectionId) {
        const normalizedSearch = searchQuery.toLocaleLowerCase();
        nextItems = nextItems.filter((item) => {
          const mime = libraryItemMIME(item);
          const matchesSearch = !normalizedSearch || [item.display_name, item.caption, item.tags.join(" "), item.file.original_filename].join(" ").toLocaleLowerCase().includes(normalizedSearch);
          const matchesMedia = !mediaType || mediaType === "document" ? !mediaType || !/^(image|video|audio)\//.test(mime) : mime.startsWith(`${mediaType}/`);
          return matchesSearch && matchesMedia;
        });
        if (sort !== "album-order") nextItems.sort((left, right) => compareLibraryItems(left, right, sort, direction));
      }
      setItems(nextItems);
      setVisibleItems(nextItems);
      setNextAfter(collection === "recent-days" || collection === "months" || collection === "years" || collection === "people" || collection === "groups" || collection === "memory" || collection === "trip" || collection === "map" || collection === "duplicate" || collection === "albums" && selectedCollectionId ? "" : (library as { next_after?: string }).next_after ?? "");
    }).catch((error: unknown) => {
      if (!current) return;
      if (error instanceof SpaceRequestError && error.code === "library_reauthentication_required" && sensitiveCollectionScope) {
        setSensitiveGrants((grants) => ({ ...grants, [sensitiveCollectionScope]: undefined }));
        return;
      }
      setLocalError(error instanceof Error ? error.message : "Library could not be loaded.");
    }).finally(() => current && setLoading(false));
    return () => { current = false; };
  }, [collection, libraryQuery, mediaType, peoplePolicy?.semantic_search_enabled, reloadKey, searchQuery, selectedCollectionId, sensitiveCollectionScope, sensitiveCollectionToken, sort, direction, spaceId]);

  useEffect(() => {
    if (collection !== "memory" || !selectedCollectionId) {
      setMemoryAudioItems([]);
      return;
    }
    let current = true;
    void spacesApi.libraryItems(spaceId, { media_type: "audio", limit: 200 }).then((result) => current && setMemoryAudioItems(result.items)).catch(() => current && setMemoryAudioItems([]));
    return () => { current = false; };
  }, [collection, selectedCollectionId, spaceId]);

  useEffect(() => {
    setSelectedItemIds([]);
  }, [collection, mediaType, searchQuery, selectedCollectionId, sort, direction, spaceId]);

  const reload = async () => {
    const [currentUsage, albumResult, folderResult, groupResult, policyResult, peopleResult, discoveryResult, sharedResult, pinResult, importResult, stackResult] = await Promise.all([spacesApi.libraryUsage(spaceId), spacesApi.albums(spaceId), spacesApi.albumFolders(spaceId).catch(() => ({ folders: [] })), spacesApi.groups(spaceId).catch(() => ({ groups: [] })), spacesApi.peoplePolicy(spaceId).catch(() => null), spacesApi.people(spaceId).catch(() => ({ people: [] })), spacesApi.libraryDiscovery(spaceId).catch(() => ({ recent_days: [], months: [], years: [], memories: [], trips: [], duplicates: [], map_points: [] })), spacesApi.sharedReferences(spaceId).catch(() => ({ references: [], outgoing: [] })), spacesApi.libraryPins(spaceId).catch(() => ({ pins: [] })), spacesApi.libraryImportHistory(spaceId).catch(() => ({ imports: [] })), spacesApi.libraryAssetStacks(spaceId).catch(() => ({ stacks: [] }))]);
    setUsage(currentUsage);
    setAlbums(albumResult.albums);
    setAlbumFolders(folderResult.folders);
    setGroups(groupResult.groups);
    setPeoplePolicy(policyResult);
    setPeople(peopleResult.people);
    setDiscovery(discoveryResult);
    setSharedReferences(sharedResult.references);
    setOutgoingReferences(sharedResult.outgoing);
    setPins(pinResult.pins);
    setImportHistory(importResult.imports);
    setAssetStacks(stackResult.stacks);
    setReloadKey((current) => current + 1);
  };

  const loadMore = async () => {
    if (!nextAfter || loadingMore || collection === "groups") return;
    setLoadingMore(true);
    try {
      const result = await spacesApi.libraryItems(spaceId, { ...libraryQuery, after: nextAfter }, sensitiveCollectionToken);
      setItems((current) => [...current, ...result.items]);
      setVisibleItems((current) => [...current, ...result.items]);
      setNextAfter(result.next_after ?? "");
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "More Library items could not be loaded.");
    } finally {
      setLoadingMore(false);
    }
  };

  const uploadFiles = async (paths: string[]) => {
    if (!canUploadLibrary || paths.length === 0) return;
    setLocalError("");
    const jobs = paths.map((path, index): LibraryUploadJob => ({
      id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`,
      path,
      name: path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "file",
      stage: "queued",
      progress: 0,
    }));
    setUploadJobs(jobs);
    const uploaded: SpaceLibraryItem[] = [];
    let cursor = 0;
    const updateJob = (id: string, patch: Partial<LibraryUploadJob>) => {
      setUploadJobs((current) => current.map((job) => job.id === id ? { ...job, ...patch } : job));
    };
    const worker = async () => {
      while (cursor < jobs.length) {
        const job = jobs[cursor++];
        try {
          const result = await spacesApi.uploadLibraryPath(spaceId, job.path, "library", {
            onStage: (stage) => updateJob(job.id, { stage, progress: stage === "finalizing" ? 1 : 0 }),
            onProgress: (progress) => updateJob(job.id, { progress }),
          });
          if (result.item) uploaded.push(result.item);
          updateJob(job.id, { stage: "ready", progress: 1 });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Upload failed.";
          updateJob(job.id, { stage: "failed", error: message });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(2, jobs.length) }, () => worker()));
    await Promise.allSettled(detectUploadedAssetStacks(uploaded).map((input) => spacesApi.createLibraryAssetStack(spaceId, input)));
    await reload();
  };

  const createSelectedAssetStack = async (kind: LibraryAssetStack["kind"]) => {
    if (!canEditLibrary) return;
    const input = buildLibraryAssetStack(kind, selectedItems);
    if (!input) {
      setLocalError(kind === "live_photo" ? "Select one image and one video to make a Live Photo." : kind === "raw_pair" ? "Select one RAW file and one rendered image to make a RAW pair." : "Select at least two images to make a burst.");
      return;
    }
    setBulkSaving(true);
    setLocalError("");
    try {
      await spacesApi.createLibraryAssetStack(spaceId, input, sensitiveCollectionToken);
      setSelectedItemIds([]);
      await reload();
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "The selected files could not be grouped.");
    } finally {
      setBulkSaving(false);
    }
  };

  const duplicateItems = async (itemIDs: string[]) => {
    if (!canEditLibrary || !canCopyLibrary || itemIDs.length === 0 || bulkSaving) return;
    setBulkSaving(true);
    setLocalError("");
    try {
      await spacesApi.duplicateLibraryItems(spaceId, itemIDs, sensitiveCollectionToken);
      setSelectedItemIds([]);
      await reload();
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "The selected Library items could not be duplicated.");
    } finally {
      setBulkSaving(false);
    }
  };

  const copyItemsToClipboard = async (itemsToCopy: SpaceLibraryItem[]) => {
    if (!canCopyLibrary || itemsToCopy.length === 0 || bulkSaving) return;
    setBulkSaving(true);
    setLocalError("");
    try {
      await copyLibraryItemsToClipboard(spaceId, itemsToCopy, sensitiveCollectionToken);
      setSelectedItemIds([]);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "The selected Library items could not be copied.");
    } finally {
      setBulkSaving(false);
    }
  };

  const copySharedReferenceToClipboard = async (reference: LibrarySharedReference) => {
    if (!canCopyLibrary || bulkSaving) return;
    setBulkSaving(true);
    setLocalError("");
    try {
      const blob = await spacesApi.sharedReferenceContent(spaceId, reference.id);
      await copyBlobFilesToClipboard([{ name: reference.display_name, blob }]);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "The shared Library item could not be copied.");
    } finally {
      setBulkSaving(false);
    }
  };

  useEffect(() => {
    if (!canCopyLibrary || selectedItems.length === 0 || selectedItemId) return;
    const copySelection = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "c") return;
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      event.preventDefault();
      void copyItemsToClipboard(selectedItems);
    };
    window.addEventListener("keydown", copySelection);
    return () => window.removeEventListener("keydown", copySelection);
  }, [canCopyLibrary, selectedItemId, selectedItems]);

  const pasteEdits = async () => {
    if (!canEditLibrary || !copiedEditDefinition || selectedItems.length === 0 || bulkSaving) return;
    const editableItems = selectedItems.filter((item) => /^(image|video)\//.test(libraryItemMIME(item)));
    if (editableItems.length === 0) {
      setLocalError("Select images or videos to paste these edits.");
      return;
    }
    setBulkSaving(true);
    setLocalError("");
    try {
      for (const item of editableItems) {
        const result = await spacesApi.createEditVersion(spaceId, item, copiedEditDefinition, sensitiveCollectionToken);
        if (result.edit) await spacesApi.renderEditVersion(spaceId, item.id, result.edit.id, 0, sensitiveCollectionToken);
      }
      setSelectedItemIds([]);
      await reload();
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "The edits could not be pasted.");
    } finally {
      setBulkSaving(false);
    }
  };

  const setAssetStackCover = async (stack: LibraryAssetStack, coverItemID: string) => {
    try {
      const saved = await spacesApi.updateLibraryAssetStack(spaceId, stack, { cover_item_id: coverItemID }, sensitiveCollectionToken);
      setAssetStacks((current) => current.map((candidate) => candidate.id === saved.id ? saved : candidate));
      setSelectedItemId(saved.cover_item_id);
      await reload();
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "The key photo could not be changed.");
    }
  };

  const setAssetStackEffect = async (stack: LibraryAssetStack, effect: LibraryAssetStack["effect"]) => {
    try {
      const saved = await spacesApi.updateLibraryAssetStack(spaceId, stack, { effect }, sensitiveCollectionToken);
      setAssetStacks((current) => current.map((candidate) => candidate.id === saved.id ? saved : candidate));
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "The Live Photo effect could not be changed.");
    }
  };

  const ungroupAssetStack = async (stack: LibraryAssetStack) => {
    if (!await confirmAction(`Separate this ${stack.kind === "live_photo" ? "Live Photo" : stack.kind === "raw_pair" ? "RAW pair" : "burst"}?`)) return;
    try {
      await spacesApi.deleteLibraryAssetStack(spaceId, stack, sensitiveCollectionToken);
      setAssetStacks((current) => current.filter((candidate) => candidate.id !== stack.id));
      await reload();
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "The grouped media could not be separated.");
    }
  };

  const updateItem = async (item: SpaceLibraryItem, patch: Partial<Pick<SpaceLibraryItem, "display_name" | "caption" | "favorite" | "hidden" | "tags">>) => {
    if (!canEditLibrary) return null;
    try {
      const saved = await spacesApi.updateLibraryItem(spaceId, item, patch, sensitiveCollectionToken);
      const remainsVisible = collection === "hidden" ? saved.hidden : !saved.hidden && (collection !== "favorites" || saved.favorite);
      setItems((current) => remainsVisible ? current.map((candidate) => candidate.id === saved.id ? saved : candidate) : current.filter((candidate) => candidate.id !== saved.id));
      setVisibleItems((current) => remainsVisible ? current.map((candidate) => candidate.id === saved.id ? saved : candidate) : current.filter((candidate) => candidate.id !== saved.id));
      return saved;
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Library item could not be updated.");
      return null;
    }
  };

  const replaceItem = (saved: SpaceLibraryItem) => {
    setItems((current) => current.map((item) => item.id === saved.id ? saved : item));
    setVisibleItems((current) => current.map((item) => item.id === saved.id ? saved : item));
  };

  const trashItem = async (item: SpaceLibraryItem) => {
    if (!canEditLibrary) return false;
    if (!await confirmAction(`Move “${item.display_name}” to Recently Deleted?`)) return false;
    try {
      await spacesApi.trashLibraryItem(spaceId, item.id, sensitiveCollectionToken);
      setItems((current) => current.filter((candidate) => candidate.id !== item.id));
      setVisibleItems((current) => current.filter((candidate) => candidate.id !== item.id));
      setSelectedItemId("");
      return true;
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Library item could not be moved to Recently Deleted.");
      return false;
    }
  };

  const restoreItem = async (item: SpaceLibraryItem) => {
    if (!canEditLibrary) return;
    try {
      await spacesApi.restoreLibraryItem(spaceId, item.id, sensitiveCollectionToken);
      setItems((current) => current.filter((candidate) => candidate.id !== item.id));
      setVisibleItems((current) => current.filter((candidate) => candidate.id !== item.id));
      setSelectedItemId("");
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Library item could not be restored.");
    }
  };

  const toggleSelectedItem = (itemId: string) => {
    setSelectedItemIds((current) => current.includes(itemId) ? current.filter((id) => id !== itemId) : [...current, itemId]);
  };

  const appendSearchFacet = (key: "tag" | "type" | "album" | "year", value: string) => {
    const escapedValue = /\s/.test(value) ? `"${value.replace(/"/g, "")}"` : value;
    setSearchInput((current) => `${current.trim()} ${key}:${escapedValue}`.trim());
  };

  const applyBulkAction = async (action: BulkLibraryItemAction, options: BulkLibraryItemOptions = {}) => {
    if (!canEditLibrary || selectedItems.length === 0 || bulkSaving) return false;
    if (action === "trash" && !await confirmAction(`Move ${selectedItems.length} selected item${selectedItems.length === 1 ? "" : "s"} to Recently Deleted?`)) return false;
    setBulkSaving(true);
    setLocalError("");
    try {
      await spacesApi.bulkLibraryItems(spaceId, selectedItems, action, options, sensitiveCollectionToken);
      setSelectedItemIds([]);
      await reload();
      return true;
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Selected Library items could not be updated.");
      return false;
    } finally {
      setBulkSaving(false);
    }
  };

  const openMetadataDialog = (action: "add_tags" | "remove_tags" | "set_date" | "set_location") => {
    rememberLibraryDialogTrigger();
    setMetadataTags("");
    setMetadataDate("");
    setMetadataLocationName("");
    setMetadataLatitude("");
    setMetadataLongitude("");
    setMetadataDialogAction(action);
  };

  const saveBulkMetadata = async (event: FormEvent) => {
    event.preventDefault();
    if (!metadataDialogAction || bulkSaving) return;
    let options: BulkLibraryItemOptions = {};
    if (metadataDialogAction === "add_tags" || metadataDialogAction === "remove_tags") {
      const tags = metadataTags.split(",").map((tag) => tag.trim()).filter(Boolean);
      if (tags.length === 0) return;
      options = { tags };
    } else if (metadataDialogAction === "set_date") {
      if (!metadataDate) return;
      options = { dateOverride: new Date(metadataDate).toISOString() };
    } else {
      const location: Record<string, unknown> = {};
      if (metadataLocationName.trim()) location.name = metadataLocationName.trim();
      if (metadataLatitude.trim()) {
        const latitude = Number(metadataLatitude);
        if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
          setLocalError("Latitude must be between -90 and 90.");
          return;
        }
        location.latitude = latitude;
      }
      if (metadataLongitude.trim()) {
        const longitude = Number(metadataLongitude);
        if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
          setLocalError("Longitude must be between -180 and 180.");
          return;
        }
        location.longitude = longitude;
      }
      if (Object.keys(location).length === 0) return;
      options = { locationOverride: location };
    }
    if (await applyBulkAction(metadataDialogAction, options)) setMetadataDialogAction("");
  };

  const clearBulkMetadata = async (action: "clear_date" | "clear_location", label: string) => {
    if (!await confirmAction(`Clear ${label} from ${selectedItems.length} selected item${selectedItems.length === 1 ? "" : "s"}?`)) return;
    await applyBulkAction(action);
  };

  const requestSensitiveUnlock = (scope: "hidden" | "recently_deleted") => {
    rememberLibraryDialogTrigger();
    setUnlockPassword("");
    setUnlockScope(scope);
  };

  const submitSensitiveUnlock = async (event: FormEvent) => {
    event.preventDefault();
    if (!unlockScope || !unlockPassword || unlockSaving) return;
    setUnlockSaving(true);
    setLocalError("");
    try {
      const grant = await spacesApi.reauthenticateLibrary(spaceId, unlockScope, unlockPassword);
      setSensitiveGrants((current) => ({ ...current, [unlockScope]: { token: grant.token, expiresAt: grant.expires_at } }));
      setUnlockScope("");
      setUnlockPassword("");
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "This collection could not be unlocked.");
    } finally {
      setUnlockSaving(false);
    }
  };

  const mergeCurrentDuplicates = async () => {
    if (!canEditLibrary || collection !== "duplicate" || visibleItems.length < 2 || bulkSaving || !await confirmAction(`Merge ${visibleItems.length} matching items? Misty will keep one item, combine metadata and references, and move the redundant copies to Recently Deleted.`)) return;
    setBulkSaving(true);
    setLocalError("");
    try {
      await spacesApi.mergeDuplicates(spaceId, visibleItems[0], visibleItems.slice(1));
      selectCollection("duplicate");
      await reload();
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Duplicates could not be merged.");
    } finally {
      setBulkSaving(false);
    }
  };

  const revokeSharedReference = async (reference: LibrarySharedReference) => {
    if (!canEditLibrary) return;
    if (!await confirmAction(`Stop sharing “${reference.display_name}” with ${reference.destination_space_name}?`)) return;
    try {
      await spacesApi.revokeLibraryGrant(spaceId, reference);
      setOutgoingReferences((current) => current.filter((item) => item.grant_id !== reference.grant_id));
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Sharing could not be revoked.");
    }
  };

  const selectCollection = (next: LibraryCollectionKind, id = "") => {
    setCollection(next);
    setSelectedCollectionId(id);
    const nextSearchParams = new URLSearchParams(librarySearchParams);
    nextSearchParams.set("collection", next);
    if (id) nextSearchParams.set("collectionId", id);
    else nextSearchParams.delete("collectionId");
    if (nextSearchParams.toString() !== librarySearchParams.toString()) setLibrarySearchParams(nextSearchParams, { replace: true });
    if (next === "albums" && id) { setSort("album-order"); setDirection("asc"); }
    else if (sort === "album-order") { setSort("recently-added"); setDirection("desc"); }
  };

  useEffect(() => {
    if (!requestedCollection || !libraryCollectionKinds.has(requestedCollection as LibraryCollectionKind)) return;
    const nextCollection = requestedCollection as LibraryCollectionKind;
    setCollection(nextCollection);
    setSelectedCollectionId(requestedCollectionId);
    if (nextCollection === "albums" && requestedCollectionId) {
      setSort("album-order");
      setDirection("asc");
    } else {
      setSort((current) => current === "album-order" ? "recently-added" : current);
    }
  }, [requestedCollection, requestedCollectionId]);
  const isPinned = (kind: LibraryPinnedCollection["target_kind"], id: string) => pins.some((pin) => pin.target_kind === kind && pin.target_id === id);

  const togglePin = async (kind: LibraryPinnedCollection["target_kind"], id: string) => {
    if (!canEditLibrary) return;
    const exists = isPinned(kind, id);
    const targets = exists
      ? pins.filter((pin) => pin.target_kind !== kind || pin.target_id !== id).map((pin) => ({ kind: pin.target_kind, id: pin.target_id }))
      : [...pins.map((pin) => ({ kind: pin.target_kind, id: pin.target_id })), { kind, id }];
    try {
      const result = await spacesApi.setLibraryPins(spaceId, targets);
      setPins(result.pins);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Pinned collections could not be updated.");
    }
  };

  const movePin = async (pinID: string, delta: -1 | 1) => {
    if (!canEditLibrary) return;
    const index = pins.findIndex((pin) => pin.id === pinID);
    const destination = index + delta;
    if (index < 0 || destination < 0 || destination >= pins.length) return;
    const reordered = [...pins];
    [reordered[index], reordered[destination]] = [reordered[destination], reordered[index]];
    setPins(reordered.map((pin, position) => ({ ...pin, position })));
    try {
      const result = await spacesApi.setLibraryPins(spaceId, reordered.map((pin) => ({ kind: pin.target_kind, id: pin.target_id })));
      setPins(result.pins);
    } catch (error) {
      setPins(pins);
      setLocalError(error instanceof Error ? error.message : "Pinned collections could not be reordered.");
    }
  };

  const updateCurrentMemory = async (patch: { title?: string; cover_item_id?: string; music_item_id?: string; playback_seconds?: number }) => {
    if (!canEditLibrary || !currentDiscoveryGroup || currentDiscoveryGroup.kind !== "memory") return null;
    try {
      const saved = await spacesApi.updateMemoryPreference(spaceId, currentDiscoveryGroup, patch);
      setDiscovery((current) => ({ ...current, memories: current.memories.map((memory) => memory.id === saved.id ? saved : memory) }));
      return saved;
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Memory could not be updated.");
      return null;
    }
  };

  const pinnedDescriptor = (pin: LibraryPinnedCollection): { label: string; count: number; icon: LucideIcon; onClick: () => void } | null => {
    if (pin.target_kind === "album") {
      const album = albums.find((candidate) => candidate.id === pin.target_id);
      return album ? { label: album.name, count: album.item_count, icon: LibraryIcon, onClick: () => selectCollection("albums", album.id) } : null;
    }
    if (pin.target_kind === "group") {
      const group = groups.find((candidate) => candidate.id === pin.target_id);
      return group ? { label: group.name, count: group.rules.all.length, icon: SlidersHorizontal, onClick: () => selectCollection("groups", group.id) } : null;
    }
    if (pin.target_kind === "person") {
      const person = people.find((candidate) => candidate.id === pin.target_id);
      return person ? { label: person.name || (person.kind === "pet" ? "Unnamed pet" : "Unnamed person"), count: person.item_count, icon: Users, onClick: () => selectCollection("people", person.id) } : null;
    }
    if (pin.target_kind === "memory" || pin.target_kind === "trip") {
      const kind = pin.target_kind;
      const group = (kind === "memory" ? discovery.memories : discovery.trips).find((candidate) => candidate.id === pin.target_id);
      return group ? { label: group.title, count: group.item_count, icon: kind === "memory" ? Sparkles : MapPin, onClick: () => selectCollection(kind, group.id) } : null;
    }
    if (pin.target_kind === "map") {
      const point = discovery.map_points.find((candidate) => candidate.id === pin.target_id);
      return point ? { label: point.name, count: point.item_count, icon: MapIcon, onClick: () => selectCollection("map", point.id) } : null;
    }
    const system: Partial<Record<string, { label: string; count: number; icon: LucideIcon; collection: LibraryCollectionKind }>> = {
      recent: { label: "Recently Added", count: searchFacets.total, icon: LibraryIcon, collection: "recent" },
      months: { label: "Months", count: discovery.months.length, icon: History, collection: "months" },
      years: { label: "Years", count: discovery.years.length, icon: History, collection: "years" },
      "recent-days": { label: "Recent Days", count: discovery.recent_days.length, icon: LibraryIcon, collection: "recent-days" },
      favorites: { label: "Favorites", count: searchFacets.favorites, icon: Star, collection: "favorites" },
      people: { label: "People & Pets", count: people.length, icon: Users, collection: "people" },
      albums: { label: "Albums", count: albums.length, icon: LibraryIcon, collection: "albums" },
      groups: { label: "Groups", count: groups.length, icon: SlidersHorizontal, collection: "groups" },
      map: { label: "Map", count: discovery.map_points.reduce((total, point) => total + point.item_count, 0), icon: MapIcon, collection: "map" },
      shared: { label: "Shared", count: sharedReferences.length + outgoingReferences.length, icon: MessagesSquare, collection: "shared" },
      imports: { label: "Imports", count: importHistory.length, icon: History, collection: "imports" },
      hidden: { label: "Hidden", count: searchFacets.hidden, icon: EyeOff, collection: "hidden" },
      deleted: { label: "Recently Deleted", count: searchFacets.recently_deleted, icon: Trash2, collection: "deleted" },
    };
    const utility = searchFacets.utilities.find((facet) => facet.value === pin.target_id);
    if (utility) return { label: utility.label, count: utility.count, icon: libraryUtilityIcon(utility.value), onClick: () => selectCollection("utility", utility.value) };
    const media = searchFacets.media_types.find((facet) => facet.value === pin.target_id);
    if (media) return { label: media.label, count: media.count, icon: media.value === "image" ? ImageIcon : media.value === "video" ? Video : media.value === "audio" ? Music2 : File, onClick: () => { setMediaType(media.value as typeof mediaType); selectCollection("recent"); } };
    const descriptor = system[pin.target_id];
    return descriptor ? { label: descriptor.label, count: descriptor.count, icon: descriptor.icon, onClick: () => selectCollection(descriptor.collection) } : null;
  };

  const openCreateAlbum = () => {
    if (!canEditLibrary) return;
    rememberLibraryDialogTrigger();
    setAlbumName("");
    setAlbumDescription("");
    setAlbumCoverItemId("");
    setAlbumDialogMode("create");
  };

  const openEditAlbum = () => {
    if (!canEditLibrary || !currentAlbum) return;
    rememberLibraryDialogTrigger();
    setAlbumName(currentAlbum.name);
    setAlbumDescription(currentAlbum.description);
    setAlbumCoverItemId(currentAlbum.cover_item_id ?? "");
    setAlbumDialogMode("edit");
  };

  const saveAlbum = async (event: FormEvent) => {
    event.preventDefault();
    const name = albumName.trim();
    if (!canEditLibrary || !name || albumSaving) return;
    setAlbumSaving(true);
    try {
      if (albumDialogMode === "edit" && currentAlbum) {
        const saved = await spacesApi.updateAlbum(spaceId, currentAlbum, { name, description: albumDescription.trim(), cover_item_id: albumCoverItemId });
        setAlbums((current) => current.map((album) => album.id === saved.id ? saved : album).sort((a, b) => a.name.localeCompare(b.name)));
      } else {
        let album = await spacesApi.createAlbum(spaceId, name, albumDescription.trim());
        if (selectedAlbumFolderId) album = await spacesApi.organizeAlbum(spaceId, album, { folder_id: selectedAlbumFolderId });
        setAlbums((current) => [...current, album].sort((a, b) => a.name.localeCompare(b.name)));
        selectCollection("albums", album.id);
      }
      setAlbumDialogMode("");
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Album could not be saved.");
    } finally {
      setAlbumSaving(false);
    }
  };

  const createAlbumFolder = () => {
    if (!canEditLibrary) return;
    showTextDialog({ kind: "create-folder", title: "New album folder", primaryLabel: "Folder name", primaryValue: "" });
  };

  const renameAlbumFolder = () => {
    if (!canEditLibrary) return;
    const folder = albumFolders.find((candidate) => candidate.id === selectedAlbumFolderId);
    if (!folder) return;
    showTextDialog({ kind: "rename-folder", title: "Rename album folder", primaryLabel: "Folder name", primaryValue: folder.name });
  };

  const deleteAlbumFolder = async () => {
    if (!canEditLibrary) return;
    const folder = albumFolders.find((candidate) => candidate.id === selectedAlbumFolderId);
    if (!folder || !await confirmAction(`Delete “${folder.name}”? Albums will move to the top level.`)) return;
    try {
      await spacesApi.deleteAlbumFolder(spaceId, folder);
      setAlbumFolders((current) => current.filter((candidate) => candidate.id !== folder.id && candidate.parent_folder_id !== folder.id));
      setAlbums((current) => current.map((album) => album.folder_id === folder.id ? { ...album, folder_id: undefined } : album));
      setSelectedAlbumFolderId(folder.parent_folder_id ?? "");
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Album folder could not be deleted.");
    }
  };

  const deleteCurrentAlbum = async () => {
    if (!canEditLibrary || !currentAlbum || !await confirmAction(`Delete “${currentAlbum.name}”? Its Library items will not be deleted.`)) return;
    try {
      await spacesApi.deleteAlbum(spaceId, currentAlbum);
      setAlbums((current) => current.filter((album) => album.id !== currentAlbum.id));
      selectCollection("collections");
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Album could not be deleted.");
    }
  };

  const reorderAlbumItem = async (targetItemId: string) => {
    if (!canEditLibrary || !currentAlbum || !canReorderAlbum || !draggedAlbumItemId || draggedAlbumItemId === targetItemId) return;
    const nextItems = [...visibleItems];
    const from = nextItems.findIndex((item) => item.id === draggedAlbumItemId);
    const to = nextItems.findIndex((item) => item.id === targetItemId);
    if (from < 0 || to < 0) return;
    const [moved] = nextItems.splice(from, 1);
    nextItems.splice(to, 0, moved);
    setItems(nextItems);
    setVisibleItems(nextItems);
    setDraggedAlbumItemId("");
    try {
      const saved = await spacesApi.reorderAlbumItems(spaceId, currentAlbum, nextItems.map((item) => item.id));
      setAlbums((current) => current.map((album) => album.id === saved.id ? saved : album));
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Album order could not be saved.");
      setReloadKey((current) => current + 1);
    }
  };

  const togglePeoplePolicy = async (kind: "person" | "pet") => {
    if (!canEditLibrary || !peoplePolicy) return;
    try {
      const saved = await spacesApi.updatePeoplePolicy(spaceId, peoplePolicy, kind === "person" ? { faces_enabled: !peoplePolicy.faces_enabled } : { pets_enabled: !peoplePolicy.pets_enabled });
      setPeoplePolicy(saved);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "People & Pets settings could not be updated.");
    }
  };

  const toggleIntelligencePolicy = async (kind: "ai" | "semantic") => {
    if (!canEditLibrary || !peoplePolicy) return;
    const patch = kind === "ai"
        ? { ai_enabled: !peoplePolicy.ai_enabled, ...peoplePolicy.ai_enabled ? { semantic_search_enabled: false } : {} }
        : { semantic_search_enabled: !peoplePolicy.semantic_search_enabled, ...peoplePolicy.semantic_search_enabled ? {} : { ai_enabled: true } };
    try {
      const saved = await spacesApi.updatePeoplePolicy(spaceId, peoplePolicy, patch);
      setPeoplePolicy(saved);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Library intelligence settings could not be updated.");
    }
  };

  const openCreatePerson = (kind: "person" | "pet") => {
    if (!canEditLibrary) return;
    rememberLibraryDialogTrigger();
    setPersonKind(kind);
    setPersonName("");
    setPersonCoverItemId("");
    setPersonDialogMode("create");
  };

  const openEditPerson = () => {
    if (!canEditLibrary || !currentPerson) return;
    rememberLibraryDialogTrigger();
    setPersonKind(currentPerson.kind);
    setPersonName(currentPerson.name);
    setPersonCoverItemId(currentPerson.cover_item_id ?? "");
    setPersonDialogMode("edit");
  };

  const savePerson = async (event: FormEvent) => {
    event.preventDefault();
    if (!canEditLibrary || personSaving) return;
    setPersonSaving(true);
    try {
      if (personDialogMode === "edit" && currentPerson) {
        const saved = await spacesApi.updatePerson(spaceId, currentPerson, { name: personName.trim(), cover_item_id: personCoverItemId });
        setPeople((current) => current.map((person) => person.id === saved.id ? saved : person));
      } else {
        const saved = await spacesApi.createPerson(spaceId, personKind, personName.trim());
        setPeople((current) => [...current, saved]);
        selectCollection("people", saved.id);
      }
      setPersonDialogMode("");
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Person or pet could not be saved.");
    } finally {
      setPersonSaving(false);
    }
  };

  const deleteCurrentPerson = async () => {
    if (!canEditLibrary || !currentPerson || !await confirmAction(`Remove “${currentPerson.name || (currentPerson.kind === "pet" ? "Unnamed pet" : "Unnamed person")}" from People & Pets? Library items will not be deleted.`)) return;
    try {
      await spacesApi.deletePerson(spaceId, currentPerson);
      setPeople((current) => current.filter((person) => person.id !== currentPerson.id));
      selectCollection("people");
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Person or pet could not be removed.");
    }
  };

  const mergeCurrentPerson = async (targetID: string) => {
    if (!canEditLibrary || !currentPerson || !targetID) return;
    const target = people.find((person) => person.id === targetID);
    if (!target || !await confirmAction(`Merge “${currentPerson.name || "Unnamed"}” into “${target.name || "Unnamed"}”?`)) return;
    try {
      const saved = await spacesApi.mergePeople(spaceId, currentPerson, target);
      setPeople((current) => current.filter((person) => person.id !== currentPerson.id).map((person) => person.id === saved.id ? saved : person));
      selectCollection("people", saved.id);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "People could not be merged.");
    }
  };

  const applyPersonItems = async (personID: string, remove = false) => {
    if (!canEditLibrary || selectedItems.length === 0 || bulkSaving) return;
    setBulkSaving(true);
    try {
      const saved = remove ? await spacesApi.removePersonItems(spaceId, personID, selectedItems.map((item) => item.id)) : await spacesApi.addPersonItems(spaceId, personID, selectedItems.map((item) => item.id));
      setPeople((current) => current.map((person) => person.id === saved.id ? saved : person));
      setSelectedItemIds([]);
      setReloadKey((current) => current + 1);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Selected items could not be assigned.");
    } finally {
      setBulkSaving(false);
    }
  };

  const createGroup = () => {
    if (!canEditLibrary) return;
    showTextDialog({ kind: "create-group", title: "New smart group", primaryLabel: "Group name", primaryValue: "", secondaryLabel: "Match files with this tag", secondaryValue: "" });
  };

  const submitTextDialog = async (event: FormEvent) => {
    event.preventDefault();
    if (!canEditLibrary || !textDialog || textDialogSaving) return;
    const primaryValue = textDialog.primaryValue.trim();
    const secondaryValue = textDialog.secondaryValue?.trim() ?? "";
    if (textDialog.kind !== "edit-tags" && !primaryValue || textDialog.secondaryLabel && !secondaryValue) return;
    setTextDialogSaving(true);
    setTextDialogError("");
    try {
      if (textDialog.kind === "create-folder") {
        const folder = await spacesApi.createAlbumFolder(spaceId, primaryValue, selectedAlbumFolderId);
        setAlbumFolders((current) => [...current, folder].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name)));
        setSelectedAlbumFolderId(folder.id);
      } else if (textDialog.kind === "rename-folder") {
        const folder = albumFolders.find((candidate) => candidate.id === selectedAlbumFolderId);
        if (!folder) throw new Error("This album folder is no longer available.");
        const saved = await spacesApi.updateAlbumFolder(spaceId, folder, { name: primaryValue });
        setAlbumFolders((current) => current.map((candidate) => candidate.id === saved.id ? saved : candidate));
      } else if (textDialog.kind === "create-group") {
        const group = await spacesApi.createGroup(spaceId, primaryValue, [{ field: "tag", op: "contains", value: secondaryValue }]);
        setGroups((current) => [...current, group].sort((a, b) => a.name.localeCompare(b.name)));
        selectCollection("groups", group.id);
      } else if (textDialog.kind === "rename-memory") {
        if (!await updateCurrentMemory({ title: primaryValue })) throw new Error("The memory could not be renamed.");
      } else {
        const item = items.find((candidate) => candidate.id === textDialog.itemId);
        if (!item) throw new Error("This Library item is no longer available.");
        const updated = textDialog.kind === "rename-item"
          ? await updateItem(item, { display_name: primaryValue })
          : await updateItem(item, { tags: primaryValue.split(",").map((tag) => tag.trim()).filter(Boolean) });
        if (!updated) throw new Error("The Library item could not be updated.");
      }
      setTextDialog(null);
    } catch (error) {
      setTextDialogError(error instanceof Error ? error.message : "The change could not be saved.");
    } finally {
      setTextDialogSaving(false);
    }
  };

  const uploading = uploadJobs.some((job) => !["ready", "failed"].includes(job.stage));
  const uploadProgress = uploadJobs.length > 0 ? Math.round(uploadJobs.reduce((total, job) => total + (job.stage === "ready" || job.stage === "failed" ? 1 : job.progress), 0) / uploadJobs.length * 100) : 0;
  const failedUploads = uploadJobs.filter((job) => job.stage === "failed");
  const menuItem = itemMenu ? items.find((item) => item.id === itemMenu.itemId) ?? visibleItems.find((item) => item.id === itemMenu.itemId) ?? null : null;
  const showItemMenu = (itemId: string, left: number, top: number) => {
    const menuWidth = 224;
    const menuHeight = 336;
    setItemMenu({
      itemId,
      left: Math.max(8, Math.min(left, window.innerWidth - menuWidth - 8)),
      top: Math.max(8, Math.min(top, window.innerHeight - menuHeight - 8)),
    });
  };
  const openItemContextMenu = (event: ReactMouseEvent, itemId: string) => {
    event.preventDefault();
    event.stopPropagation();
    showItemMenu(itemId, event.clientX, event.clientY);
  };
  const addItemToAlbum = async (itemId: string, albumId: string) => {
    await spacesApi.addAlbumItems(spaceId, albumId, [itemId]);
    const result = await spacesApi.albums(spaceId);
    setAlbums(result.albums);
  };

  return (
    <LibraryCanEditContext.Provider value={canEditLibrary}>
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-transparent">
      <SpaceLibraryHeader uploadAvailable={canUploadLibrary} uploading={uploading} uploadDisabled={uploading || (usage?.remaining_bytes ?? 1) <= 0} onUpload={() => setFilePickerOpen(true)} searchInput={searchInput} onSearchInput={setSearchInput} onSearchFocus={() => setSearchFocused(true)} onSearchBlur={() => window.setTimeout(() => setSearchFocused(false), 120)} mediaType={mediaType} onMediaType={(value) => setMediaType(value as typeof mediaType)} sort={sort} direction={direction} onSort={(nextSort, nextDirection) => { setSort(nextSort); setDirection(nextDirection); }} albumOrderAvailable={Boolean(currentAlbum)} viewMode={libraryViewMode} onViewMode={setLibraryViewMode} visibleItemCount={visibleItems.length}/>
      <div className="min-h-0 overflow-auto bg-transparent px-6 pb-6 pt-5">
        {uploadJobs.length > 0 ? <div className="mb-4 overflow-hidden rounded-xl border border-[var(--misty-border-soft)] bg-[var(--misty-app-panel-bg,var(--misty-app-page-bg,var(--misty-bg)))]">
          <div className="flex items-center gap-3 px-3 py-2.5"><Upload className="shrink-0 text-[var(--misty-text-muted)]" size={15}/><div className="min-w-0 flex-1"><p className="m-0 truncate text-xs font-medium">{uploading ? `Uploading ${uploadJobs.length} file${uploadJobs.length === 1 ? "" : "s"} in the background` : failedUploads.length > 0 ? `${uploadJobs.length - failedUploads.length} uploaded, ${failedUploads.length} failed` : `${uploadJobs.length} file${uploadJobs.length === 1 ? "" : "s"} uploaded`}</p><p className="m-0 mt-0.5 truncate text-[10px] text-[var(--misty-text-subtle)]">{uploading ? `${uploadProgress}% · You can keep using Misty while this finishes` : failedUploads[0]?.error ?? "Complete"}</p></div>{!uploading ? <button className={iconButtonClass} type="button" onClick={() => setUploadJobs([])} aria-label="Dismiss upload status"><X size={14}/></button> : null}</div>
          <div className="h-0.5 bg-[var(--misty-surface-3)]"><div className="h-full bg-[var(--misty-primary)] transition-[width]" style={{ width: `${uploadProgress}%` }}/></div>
        </div> : null}
        {searchFocused && (searchFacets.tags.length > 0 || searchFacets.media_types.length > 0 || searchFacets.years.length > 0 || searchFacets.albums.length > 0 || searchFacets.utilities.length > 0) ? <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-[var(--misty-border-soft)] bg-[var(--misty-app-panel-bg,var(--misty-app-page-bg,var(--misty-bg)))] p-3" onMouseDown={(event) => event.preventDefault()}>
          {searchFacets.media_types.length > 0 ? <LibraryFacetGroup label="Media" facets={searchFacets.media_types} onSelect={(facet) => appendSearchFacet("type", facet.value)}/> : null}
          {searchFacets.tags.length > 0 ? <LibraryFacetGroup label="Tags" facets={searchFacets.tags} onSelect={(facet) => appendSearchFacet("tag", facet.value)}/> : null}
          {searchFacets.albums.length > 0 ? <LibraryFacetGroup label="Albums" facets={searchFacets.albums} onSelect={(facet) => appendSearchFacet("album", facet.label)}/> : null}
          {searchFacets.years.length > 0 ? <LibraryFacetGroup label="Years" facets={searchFacets.years} onSelect={(facet) => appendSearchFacet("year", facet.value)}/> : null}
          {searchFacets.utilities.length > 0 ? <LibraryFacetGroup label="Utilities" facets={searchFacets.utilities} onSelect={(facet) => selectCollection("utility", facet.value)}/> : null}
        </div> : null}
        {selectedItems.length > 0 ? <div className="mb-4 flex min-h-10 flex-wrap items-center gap-2 rounded-xl border border-[var(--misty-border-soft)] bg-[var(--misty-app-panel-bg,var(--misty-app-page-bg,var(--misty-bg)))] px-3 py-2 shadow-sm">
          <span className="mr-1 text-xs font-medium">{selectedItems.length} selected</span>
          {canCopyLibrary && collection !== "deleted" ? <button className={smallButtonClass} type="button" disabled={bulkSaving} onClick={() => void copyItemsToClipboard(selectedItems)}><ClipboardCopy size={12}/>Copy</button> : null}
          {canEditLibrary ? collection === "deleted" ? <button className={smallButtonClass} type="button" disabled={bulkSaving} onClick={() => void applyBulkAction("restore")}>Restore</button> : <>
            <button className={smallButtonClass} type="button" disabled={bulkSaving} onClick={() => void applyBulkAction(collection === "favorites" ? "unfavorite" : "favorite")}><Star size={12}/>{collection === "favorites" ? "Unfavorite" : "Favorite"}</button>
            {collection === "albums" && selectedCollectionId ? <button className={smallButtonClass} type="button" disabled={bulkSaving} onClick={() => void applyBulkAction("remove_from_album", { albumId: selectedCollectionId })}>Remove from album</button> : null}
            <button className={smallButtonClass} type="button" disabled={bulkSaving} onClick={() => void applyBulkAction("trash")}><Trash2 size={12}/>Delete</button>
          </> : null}
          <button className="ml-auto grid size-7 place-items-center rounded-lg border-0 bg-transparent text-[var(--misty-text-subtle)] hover:bg-[var(--misty-surface-2)] hover:text-[var(--misty-text)]" type="button" disabled={bulkSaving} onClick={() => setSelectedItemIds([])} aria-label="Clear selection"><X size={13}/></button>
        </div> : null}
        {localError ? <button className="mb-4 rounded-xl border border-red-400/20 bg-red-950/20 px-3 py-2 text-left text-xs text-red-200" type="button" onClick={() => setLocalError("")}>{localError}</button> : null}
        {(collection === "months" || collection === "years" || collection === "recent-days") && !selectedCollectionId ? <div className="mb-5"><div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3">{(collection === "months" ? discovery.months : collection === "years" ? discovery.years : discovery.recent_days).map((group) => <LibraryDiscoveryCard key={`${group.kind}:${group.id}`} spaceId={spaceId} group={group} fallbackIcon={collection === "years" ? History : LibraryIcon} onClick={() => selectCollection(collection, group.id)}/>)}</div>{(collection === "months" ? discovery.months : collection === "years" ? discovery.years : discovery.recent_days).length === 0 ? <SpaceLibraryEmptyState collection={collection} uploadAvailable={canUploadLibrary} uploading={uploading} uploadDisabled={uploading || (usage?.remaining_bytes ?? 1) <= 0} onUpload={() => setFilePickerOpen(true)}/> : null}</div> : null}
        {collection === "collections" ? <div className="grid gap-8">
          <section>
            <h4 className="mb-3 mt-0 text-sm">Recently Added</h4>
            <div className="flex gap-3 overflow-x-auto pb-2">
              {displayItems.slice(0, 10).map((item) => <button className="w-[180px] shrink-0 overflow-hidden rounded-2xl border border-[var(--misty-border-soft)] bg-[var(--misty-app-panel-bg,var(--misty-app-page-bg,var(--misty-bg)))] p-0 text-left transition-colors hover:border-[var(--misty-border-strong)]" type="button" key={item.id} onClick={(event) => { libraryViewerTriggerRef.current = event.currentTarget; setSelectedItemId(item.id); }} aria-label={`Open ${item.display_name}`}><span className="grid aspect-[4/3] w-full place-items-center overflow-hidden bg-[var(--misty-surface-2)] text-[var(--misty-text-subtle)]"><LibraryItemThumbnail spaceId={spaceId} item={item} reauthenticationToken={sensitiveCollectionToken}/></span><span className="block p-3"><span className="block truncate text-xs font-medium text-[var(--misty-text)]">{item.display_name}</span><span className="mt-1 block truncate text-[10px] text-[var(--misty-text-subtle)]">{formatBytes(Number(item.file.intrinsic_metadata.byte_size ?? 0))} · {formatTime(item.added_at)}</span></span></button>)}
              {displayItems.length === 0 ? <p className="m-0 py-4 text-xs text-[var(--misty-text-subtle)]">No recently added items.</p> : null}
            </div>
          </section>
          <section>
            <div className="mb-3 flex items-center justify-between gap-3"><h4 className="m-0 text-sm">Albums</h4>{canEditLibrary ? <button className={secondaryButtonClass} type="button" onClick={openCreateAlbum}><Plus size={13}/>New album</button> : null}</div>
            <div className="flex gap-3 overflow-x-auto pb-2">
              {albums.map((album) => <button className="w-[180px] shrink-0 overflow-hidden rounded-2xl border border-[var(--misty-border-soft)] bg-[var(--misty-app-panel-bg,var(--misty-app-page-bg,var(--misty-bg)))] p-0 text-left transition-colors hover:border-[var(--misty-border-strong)]" type="button" key={album.id} onClick={() => selectCollection("albums", album.id)}><AlbumCover spaceId={spaceId} itemId={album.cover_item_id}/><span className="block p-3"><span className="block truncate text-xs font-medium">{album.name}</span><span className="mt-1 block text-[10px] text-[var(--misty-text-subtle)]">{album.item_count} items</span></span></button>)}
              {albums.length === 0 ? <p className="m-0 py-4 text-xs text-[var(--misty-text-subtle)]">No albums yet.</p> : null}
            </div>
          </section>
          <section>
            <div className="mb-3 flex items-center justify-between gap-3"><h4 className="m-0 text-sm">Groups</h4>{canEditLibrary ? <button className={secondaryButtonClass} type="button" onClick={() => void createGroup()}><Plus size={13}/>New smart group</button> : null}</div>
            <div className="flex gap-3 overflow-x-auto pb-2">
              {groups.map((group) => <button className="w-[180px] shrink-0 rounded-2xl border border-[var(--misty-border-soft)] bg-[var(--misty-app-panel-bg,var(--misty-app-page-bg,var(--misty-bg)))] p-4 text-left transition-colors hover:border-[var(--misty-border-strong)]" type="button" key={group.id} onClick={() => selectCollection("groups", group.id)}><LibraryIcon size={22}/><span className="mb-0 mt-5 block truncate text-xs font-medium">{group.name}</span><span className="mt-1 block truncate text-[10px] text-[var(--misty-text-subtle)]">{group.rules.all.length} rules</span></button>)}
              {groups.length === 0 ? <p className="m-0 py-4 text-xs text-[var(--misty-text-subtle)]">No groups yet.</p> : null}
            </div>
          </section>
        </div> : null}
        {collection === "albums" && !selectedCollectionId ? <div className="mb-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2">{currentAlbumFolder ? <button className="border-0 bg-transparent p-0 text-xs text-[var(--misty-text-muted)]" type="button" onClick={() => setSelectedAlbumFolderId(currentAlbumFolder.parent_folder_id ?? "")}>←</button> : null}<h4 className="m-0 text-sm">{currentAlbumFolder?.name ?? "Albums"}</h4></div>{canEditLibrary ? <div className="flex gap-2">{currentAlbumFolder ? <><button className={smallButtonClass} type="button" onClick={() => void renameAlbumFolder()}><Pencil size={12}/>Rename</button><button className={smallButtonClass} type="button" onClick={() => void deleteAlbumFolder()}><Trash2 size={12}/>Delete</button></> : null}<button className={secondaryButtonClass} type="button" onClick={() => void createAlbumFolder()}><Folder size={13}/>New folder</button><button className={secondaryButtonClass} type="button" onClick={openCreateAlbum}><Plus size={13}/>New album</button></div> : null}</div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">{visibleAlbumFolders.map((folder) => <button className="rounded-2xl border border-[var(--misty-border-soft)] bg-[var(--misty-app-panel-bg,var(--misty-app-page-bg,var(--misty-bg)))] p-4 text-left" type="button" key={folder.id} onClick={() => setSelectedAlbumFolderId(folder.id)}><Folder size={26}/><p className="mb-0 mt-5 truncate text-xs font-medium">{folder.name}</p><p className="mb-0 mt-1 text-[10px] text-[var(--misty-text-subtle)]">{folder.album_count + folder.folder_count} items</p></button>)}{visibleAlbumsForFolder.map((album) => <button className="overflow-hidden rounded-2xl border border-[var(--misty-border-soft)] bg-[var(--misty-app-panel-bg,var(--misty-app-page-bg,var(--misty-bg)))] p-0 text-left" type="button" key={album.id} onClick={() => selectCollection("albums", album.id)}><AlbumCover spaceId={spaceId} itemId={album.cover_item_id}/><div className="p-3"><p className="m-0 truncate text-xs font-medium">{album.name}</p><p className="mb-0 mt-1 text-[10px] text-[var(--misty-text-subtle)]">{album.item_count} items</p></div></button>)}</div>
          {visibleAlbumFolders.length === 0 && visibleAlbumsForFolder.length === 0 ? <div className="grid min-h-48 place-items-center text-sm text-[var(--misty-text-subtle)]">Nothing to see here...</div> : null}
        </div> : null}
        {collection === "groups" && !selectedCollectionId ? <div className="mb-5"><div className="mb-3 flex items-center justify-between"><h4 className="m-0 text-sm">Groups</h4>{canEditLibrary ? <button className={secondaryButtonClass} type="button" onClick={() => void createGroup()}><Plus size={13}/>New smart group</button> : null}</div><div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">{groups.map((group) => <button className="rounded-2xl border border-[var(--misty-border-soft)] bg-[var(--misty-app-panel-bg,var(--misty-app-page-bg,var(--misty-bg)))] p-4 text-left" type="button" key={group.id} onClick={() => void selectCollection("groups", group.id)}><LibraryIcon size={22}/><p className="mb-0 mt-3 truncate text-xs font-medium">{group.name}</p><p className="mb-0 mt-1 truncate text-[10px] text-[var(--misty-text-subtle)]">{group.rules.all.length} rules</p></button>)}</div></div> : null}
        {collection === "map" && !selectedCollectionId ? <LibraryMapView points={discovery.map_points} onBack={() => selectCollection("collections")} onSelect={(point) => selectCollection("map", point.id)}/> : null}
        {collection === "imports" ? <div className="mb-5"><button className="mb-4 border-0 bg-transparent p-0 text-xs text-[var(--misty-text-muted)]" type="button" onClick={() => selectCollection("collections")}>← Collections</button><div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">{importHistory.map((entry) => <article className="rounded-2xl border border-[var(--misty-border-soft)] bg-[var(--misty-app-panel-bg,var(--misty-app-page-bg,var(--misty-bg)))] p-4" key={entry.id}><div className="flex items-center justify-between gap-3"><History size={20}/><span className="rounded-lg bg-[var(--misty-surface-2)] px-2 py-1 text-[10px] capitalize text-[var(--misty-text-muted)]">{entry.direction}</span></div><p className="mb-0 mt-3 truncate text-xs font-medium">{entry.display_name}</p><p className="mb-0 mt-1 truncate text-[10px] text-[var(--misty-text-subtle)]">{entry.direction === "incoming" ? "From" : "To"} {entry.counterpart_space_name}</p><p className="mb-0 mt-3 text-[10px] text-[var(--misty-text-subtle)]">{formatBytes(entry.logical_bytes)} · {formatTime(entry.completed_at ?? entry.created_at)} · {entry.state}</p></article>)}</div>{importHistory.length === 0 ? <div className="grid min-h-48 place-items-center text-sm text-[var(--misty-text-subtle)]">Nothing to see here...</div> : null}</div> : null}
        {collection === "shared" ? <div className="mb-5"><button className="mb-4 border-0 bg-transparent p-0 text-xs text-[var(--misty-text-muted)]" type="button" onClick={() => selectCollection("collections")}>← Collections</button>{sharedReferences.length > 0 ? <section><h4 className="mb-3 mt-0 text-sm">Shared with this Space</h4><div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3">{sharedReferences.map((reference) => <article className="rounded-2xl border border-[var(--misty-border-soft)] bg-[var(--misty-app-panel-bg,var(--misty-app-page-bg,var(--misty-bg)))] p-4" key={reference.id}><MessagesSquare size={20}/><p className="mb-0 mt-3 truncate text-xs font-medium">{reference.display_name}</p><p className="mb-3 mt-1 truncate text-[10px] text-[var(--misty-text-subtle)]">From {reference.source_space_name} · {formatBytes(reference.byte_size)}</p>{canCopyLibrary ? <button className={smallButtonClass} type="button" disabled={bulkSaving} onClick={() => void copySharedReferenceToClipboard(reference)}><ClipboardCopy size={12}/>Copy</button> : null}</article>)}</div></section> : null}{outgoingReferences.length > 0 ? <section className="mt-7"><h4 className="mb-3 mt-0 text-sm">Shared by this Space</h4><div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3">{outgoingReferences.map((reference) => <article className="rounded-2xl border border-[var(--misty-border-soft)] bg-[var(--misty-app-panel-bg,var(--misty-app-page-bg,var(--misty-bg)))] p-4" key={reference.id}><MessagesSquare size={20}/><p className="mb-0 mt-3 truncate text-xs font-medium">{reference.display_name}</p><p className="mb-3 mt-1 truncate text-[10px] text-[var(--misty-text-subtle)]">To {reference.destination_space_name}</p>{canEditLibrary ? <button className={smallButtonClass} type="button" onClick={() => void revokeSharedReference(reference)}><X size={12}/>Stop sharing</button> : null}</article>)}</div></section> : null}{sharedReferences.length === 0 && outgoingReferences.length === 0 ? <div className="grid min-h-48 place-items-center text-sm text-[var(--misty-text-subtle)]">Nothing to see here...</div> : null}</div> : null}
        {collection === "duplicate" && !selectedCollectionId ? <div className="mb-5"><button className="mb-4 border-0 bg-transparent p-0 text-xs text-[var(--misty-text-muted)]" type="button" onClick={() => selectCollection("collections")}>← Collections</button><div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">{discovery.duplicates.map((group, index) => <LibraryDiscoveryCard key={group.id} spaceId={spaceId} group={{ ...group, title: `Duplicates ${index + 1}` }} fallbackIcon={Copy} onClick={() => selectCollection("duplicate", group.id)}/>)}</div></div> : null}
        {collection === "people" && !selectedCollectionId && peoplePolicy ? <div className="mb-5"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h4 className="m-0 text-sm">People & Pets</h4>{canEditLibrary ? <div className="flex flex-wrap gap-2">{activeSpace?.role === "owner" ? <><button className={smallButtonClass} type="button" onClick={() => void togglePeoplePolicy("person")}>{peoplePolicy.faces_enabled ? "People on" : "People off"}</button><button className={smallButtonClass} type="button" onClick={() => void togglePeoplePolicy("pet")}>{peoplePolicy.pets_enabled ? "Pets on" : "Pets off"}</button></> : null}{peoplePolicy.faces_enabled ? <button className={secondaryButtonClass} type="button" onClick={() => openCreatePerson("person")}><Plus size={13}/>Person</button> : null}{peoplePolicy.pets_enabled ? <button className={secondaryButtonClass} type="button" onClick={() => openCreatePerson("pet")}><Plus size={13}/>Pet</button> : null}</div> : null}</div><div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">{people.map((person) => <button className="overflow-hidden rounded-2xl border border-[var(--misty-border-soft)] bg-[var(--misty-app-panel-bg,var(--misty-app-page-bg,var(--misty-bg)))] p-0 text-left" type="button" key={person.id} onClick={() => selectCollection("people", person.id)}><AlbumCover spaceId={spaceId} itemId={person.cover_item_id}/><div className="p-3"><p className="m-0 truncate text-xs font-medium">{person.name || (person.kind === "pet" ? "Unnamed pet" : "Unnamed person")}</p><p className="mb-0 mt-1 text-[10px] text-[var(--misty-text-subtle)]">{person.item_count} items · {person.kind === "pet" ? "Pet" : "Person"}</p></div></button>)}</div>{people.length === 0 ? <div className="grid min-h-48 place-items-center text-sm text-[var(--misty-text-subtle)]">Nothing to see here...</div> : null}</div> : null}
        {currentDateGroup ? <div className="mb-4"><button className="border-0 bg-transparent p-0 text-xs text-[var(--misty-text-muted)]" type="button" onClick={() => selectCollection(collection)}>← {collection === "recent-days" ? "Recent Days" : collection === "months" ? "Months" : "Years"}</button><h4 className="mb-0 mt-2 text-sm">{currentDateGroup.title}</h4><p className="mb-0 mt-1 text-xs text-[var(--misty-text-subtle)]">{currentDateGroup.subtitle}</p></div> : null}
        {currentPerson ? <div className="mb-4 flex items-center justify-between gap-3"><div><button className="border-0 bg-transparent p-0 text-xs text-[var(--misty-text-muted)]" type="button" onClick={() => selectCollection("people")}>← People & Pets</button><h4 className="mb-0 mt-2 text-sm">{currentPerson.name || (currentPerson.kind === "pet" ? "Unnamed pet" : "Unnamed person")}</h4></div>{canEditLibrary ? <div className="flex flex-wrap gap-2"><select className={libraryControlClass} value="" onChange={(event) => { if (event.target.value) void mergeCurrentPerson(event.target.value); }} aria-label="Merge this identity"><option value="">Merge into…</option>{people.filter((person) => person.id !== currentPerson.id && person.kind === currentPerson.kind).map((person) => <option value={person.id} key={person.id}>{person.name || "Unnamed"}</option>)}</select><button className={smallButtonClass} type="button" onClick={openEditPerson}><Pencil size={12}/>Edit</button><button className={smallButtonClass} type="button" onClick={() => void deleteCurrentPerson()}><Trash2 size={12}/>Remove</button></div> : null}</div> : currentAlbum ? <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><button className="border-0 bg-transparent p-0 text-xs text-[var(--misty-text-muted)]" type="button" onClick={() => { setSelectedAlbumFolderId(currentAlbum.folder_id ?? ""); selectCollection("albums"); }}>← Albums</button><h4 className="mb-0 mt-2 text-sm">{currentAlbum.name}</h4>{currentAlbum.description ? <p className="mb-0 mt-1 text-xs text-[var(--misty-text-subtle)]">{currentAlbum.description}</p> : null}</div>{canEditLibrary ? <details className="relative"><summary className={`${iconButtonClass} cursor-pointer list-none [&::-webkit-details-marker]:hidden`} aria-label="Album actions"><EllipsisVertical size={15}/></summary><div className="absolute right-0 top-[calc(100%+6px)] z-30 grid w-40 gap-1 rounded-xl border border-[var(--misty-border-strong)] bg-[var(--misty-app-panel-bg,var(--misty-app-page-bg,var(--misty-bg)))] p-1.5 shadow-xl"><button className="inline-flex min-h-9 items-center gap-2 rounded-lg border-0 bg-transparent px-2.5 text-left text-xs text-[var(--misty-text)] hover:bg-[var(--misty-surface-2)]" type="button" onClick={openEditAlbum}><Pencil size={13}/>Edit album</button><button className="inline-flex min-h-9 items-center gap-2 rounded-lg border-0 bg-transparent px-2.5 text-left text-xs text-red-200 hover:bg-red-500/10" type="button" onClick={() => void deleteCurrentAlbum()}><Trash2 size={13}/>Delete album</button></div></details> : null}</div> : currentMapPoint ? <div className="mb-4"><button className="border-0 bg-transparent p-0 text-xs text-[var(--misty-text-muted)]" type="button" onClick={() => selectCollection("map")}>← Map</button><h4 className="mb-0 mt-2 text-sm">{currentMapPoint.name}</h4><p className="mb-0 mt-1 text-xs text-[var(--misty-text-subtle)]">{currentMapPoint.latitude.toFixed(2)}, {currentMapPoint.longitude.toFixed(2)}</p></div> : currentDiscoveryGroup ? <div className="mb-4 flex items-end justify-between gap-3"><div><button className="border-0 bg-transparent p-0 text-xs text-[var(--misty-text-muted)]" type="button" onClick={() => selectCollection(currentDiscoveryGroup.kind === "duplicate" ? "duplicate" : "collections")}>← {currentDiscoveryGroup.kind === "duplicate" ? "Duplicates" : "Collections"}</button><h4 className="mb-0 mt-2 text-sm">{currentDiscoveryGroup.title}</h4><p className="mb-0 mt-1 text-xs text-[var(--misty-text-subtle)]">{currentDiscoveryGroup.subtitle}</p></div><div className="flex gap-2">{currentDiscoveryGroup.kind === "memory" && visibleItems.length > 0 ? <button className={primaryButtonClass} type="button" onClick={() => setMemoryPlaybackOpen(true)}><Play size={13}/>Play memory</button> : null}{canEditLibrary && currentDiscoveryGroup.kind === "duplicate" ? <button className={primaryButtonClass} type="button" disabled={bulkSaving || visibleItems.length < 2} onClick={() => void mergeCurrentDuplicates()}>{bulkSaving ? "Merging…" : "Merge"}</button> : null}</div></div> : selectedCollectionId && !currentDateGroup ? <button className="mb-4 border-0 bg-transparent p-0 text-xs text-[var(--misty-text-muted)]" type="button" onClick={() => selectCollection("collections")}>← Collections</button> : null}
        {canEditLibrary && currentDiscoveryGroup?.kind === "memory" ? <div className="mb-4 flex flex-wrap gap-2"><button className={smallButtonClass} type="button" onClick={() => showTextDialog({ kind: "rename-memory", title: "Rename memory", primaryLabel: "Memory title", primaryValue: currentDiscoveryGroup.title })}><Pencil size={12}/>Rename</button><select className={libraryControlClass} value={currentDiscoveryGroup.cover_item_id ?? ""} onChange={(event) => void updateCurrentMemory({ cover_item_id: event.target.value })} aria-label="Choose memory key photo">{visibleItems.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.display_name}</option>)}</select><select className={libraryControlClass} value={currentDiscoveryGroup.music_item_id ?? ""} onChange={(event) => void updateCurrentMemory({ music_item_id: event.target.value })} aria-label="Choose memory music"><option value="">No music</option>{memoryAudioItems.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.display_name}</option>)}</select><select className={libraryControlClass} value={currentDiscoveryGroup.playback_seconds ?? 4.5} onChange={(event) => void updateCurrentMemory({ playback_seconds: Number(event.target.value) })} aria-label="Choose memory pace"><option value={2}>Fast</option><option value={4.5}>Medium</option><option value={7}>Slow</option></select></div> : null}
        {loading ? <div className="grid min-h-64 place-items-center text-sm text-[var(--misty-text-subtle)]">Loading Library…</div> : collection === "collections" || collection === "shared" || collection === "imports" || (collection === "recent-days" || collection === "months" || collection === "years" || collection === "people" || collection === "albums" || collection === "groups" || collection === "duplicate" || collection === "map") && !selectedCollectionId ? null : sensitiveCollectionScope && !sensitiveCollectionToken ? <div className="grid min-h-64 place-items-center"><button className={primaryButtonClass} type="button" onClick={() => requestSensitiveUnlock(sensitiveCollectionScope)}>Unlock {collection === "hidden" ? "Hidden" : "Recently Deleted"}</button></div> : displayItems.length === 0 ? (
          <SpaceLibraryEmptyState collection={collection} searching={Boolean(searchQuery || mediaType)} uploadAvailable={canUploadLibrary} uploading={uploading} uploadDisabled={uploading || (usage?.remaining_bytes ?? 1) <= 0} onUpload={() => setFilePickerOpen(true)} onClearSearch={() => { setSearchInput(""); setMediaType(""); }}/>
        ) : (
          <div className="grid gap-3.5" style={{ gridTemplateColumns: libraryViewMode === "list" ? "1fr" : "repeat(auto-fill,minmax(270px,1fr))" }}>
            {displayItems.map((item, itemIndex) => {
              const dateGroup = libraryDateGroupLabel(item, sort);
              const previousDateGroup = itemIndex > 0 ? libraryDateGroupLabel(displayItems[itemIndex - 1], sort) : "";
              const assetStack = stackByItemID.get(item.id);
              const listLayout = libraryViewMode === "list";
              return <Fragment key={item.id}>
              {dateGroup && dateGroup !== previousDateGroup ? <h4 className="col-span-full mb-0 mt-3 text-xs font-semibold text-[var(--misty-text-muted)] first:mt-0">{dateGroup}</h4> : null}
              <article className={`group relative min-w-0 rounded-2xl border bg-[var(--misty-app-panel-bg,var(--misty-app-page-bg,var(--misty-bg)))] p-2 shadow-sm transition-[border-color,background-color,box-shadow] hover:border-[var(--misty-border-strong)] hover:bg-[var(--misty-app-surface-soft-bg,var(--misty-surface))] ${listLayout ? "grid grid-cols-[132px_minmax(0,1fr)] items-center gap-3" : ""} ${selectedItemIds.includes(item.id) ? "border-[var(--misty-primary)] shadow-[0_0_0_1px_var(--misty-primary)]" : "border-[var(--misty-border-soft)]"}`} draggable={canReorderAlbum && selectedItemIds.length === 0} onContextMenu={(event) => openItemContextMenu(event, item.id)} onDragStart={() => setDraggedAlbumItemId(item.id)} onDragEnd={() => setDraggedAlbumItemId("")} onDragOver={(event) => { if (canReorderAlbum) event.preventDefault(); }} onDrop={(event) => { event.preventDefault(); void reorderAlbumItem(item.id); }}>
              <div className="relative min-w-0"><button className="relative grid aspect-[4/3] w-full place-items-center overflow-hidden rounded-xl border-0 bg-[var(--misty-surface-2)] text-[var(--misty-text-subtle)]" type="button" onClick={(event) => { libraryViewerTriggerRef.current = event.currentTarget; setSelectedItemId(item.id); }} aria-label={`Open ${item.display_name}`}><LibraryItemThumbnail spaceId={spaceId} item={item} reauthenticationToken={sensitiveCollectionToken}/>{assetStack ? <span className="absolute bottom-2 left-2 rounded-md bg-black/65 px-1.5 py-1 text-[9px] font-semibold capitalize text-white">{assetStack.kind === "live_photo" ? "Live" : assetStack.kind === "raw_pair" ? "RAW+" : `${assetStack.members.length} burst`}</span> : null}</button>{canEditLibrary || canCopyLibrary ? <button className={`absolute right-2 top-2 z-10 grid size-5 place-items-center rounded-md border shadow-sm transition-opacity ${selectedItemIds.includes(item.id) ? "border-[var(--misty-primary)] bg-[var(--misty-primary)] text-[var(--misty-primary-contrast)] opacity-100" : "pointer-events-none border-white/50 bg-black/55 text-transparent opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"}`} type="button" aria-label={`${selectedItemIds.includes(item.id) ? "Deselect" : "Select"} ${item.display_name}`} aria-pressed={selectedItemIds.includes(item.id)} onClick={(event) => { event.stopPropagation(); toggleSelectedItem(item.id); }}><Check size={12}/></button> : null}</div>
              <div className={`${listLayout ? "min-w-0 py-1 pr-1" : "px-1 pb-1 pt-2.5"}`}>
                <div className="flex min-w-0 items-start gap-2">
                  <div className="min-w-0 flex-1"><p className="m-0 truncate text-xs font-semibold text-[var(--misty-text)]" title={item.display_name}>{item.display_name}</p><p className="m-0 mt-1 truncate text-[10px] text-[var(--misty-text-subtle)]">{formatBytes(Number(item.file.intrinsic_metadata.byte_size ?? 0))} · {formatTime(item.added_at)}</p></div>
                  {canEditLibrary || canCopyLibrary ? <div className={`flex shrink-0 items-center gap-0.5 transition-opacity ${itemMenu?.itemId === item.id ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"}`} aria-label={`Actions for ${item.display_name}`}>
                    {canEditLibrary ? <button className="grid size-7 shrink-0 place-items-center rounded-lg border-0 bg-transparent text-[var(--misty-text-subtle)] hover:bg-[var(--misty-surface-2)] hover:text-[var(--misty-text)]" type="button" onClick={() => void updateItem(item, { favorite: !item.favorite })} title={item.favorite ? "Remove favorite" : "Favorite"} aria-label={`${item.favorite ? "Remove from favorites" : "Add to favorites"}: ${item.display_name}`}><Star size={14} fill={item.favorite ? "currentColor" : "none"}/></button> : null}
                    <button className="grid size-7 shrink-0 place-items-center rounded-lg border-0 bg-transparent text-[var(--misty-text-subtle)] hover:bg-[var(--misty-surface-2)] hover:text-[var(--misty-text)]" type="button" onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); showItemMenu(item.id, rect.right - 224, rect.bottom + 4); }} aria-label={`More actions for ${item.display_name}`} aria-haspopup="menu"><EllipsisVertical size={15}/></button>
                  </div> : null}
                </div>
                <dl className={`${listLayout ? "mt-3 grid grid-cols-3 gap-x-4" : "mt-3 grid gap-1.5"} text-[10px] leading-4`}>
                  <div className={listLayout ? "min-w-0" : "flex items-center justify-between gap-3"}><dt className="text-[var(--misty-text-subtle)]">Size</dt><dd className="m-0 truncate text-[var(--misty-text-muted)]">{formatBytes(Number(item.file.intrinsic_metadata.byte_size ?? 0))}</dd></div>
                  <div className={listLayout ? "min-w-0" : "flex items-center justify-between gap-3"}><dt className="text-[var(--misty-text-subtle)]">Date</dt><dd className="m-0 truncate text-[var(--misty-text-muted)]">{formatTime(item.added_at)}</dd></div>
                  <div className={listLayout ? "min-w-0" : "flex items-center justify-between gap-3"}><dt className="text-[var(--misty-text-subtle)]">File type</dt><dd className="m-0 truncate text-[var(--misty-text-muted)]">{libraryFileTypeLabel(item)}</dd></div>
                </dl>
              </div>
              </article>
              </Fragment>;
            })}
            {nextAfter ? <div className="col-span-full grid place-items-center pt-3"><button className={secondaryButtonClass} type="button" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "Loading…" : "Load more"}</button></div> : null}
          </div>
        )}
      </div>
      {itemMenu && menuItem ? <LibraryItemContextMenu
        state={itemMenu}
        item={menuItem}
        albums={albums}
        canCopy={canCopyLibrary}
        canEdit={canEditLibrary}
        deleted={collection === "deleted"}
        onClose={() => setItemMenu(null)}
        onCopy={() => void copyItemsToClipboard([menuItem])}
        onDuplicate={() => void duplicateItems([menuItem.id])}
        onRename={() => showTextDialog({ kind: "rename-item", title: "Rename Library item", primaryLabel: "Name", primaryValue: menuItem.display_name, itemId: menuItem.id })}
        onEditTags={() => showTextDialog({ kind: "edit-tags", title: "Edit tags", primaryLabel: "Tags, separated by commas", primaryValue: menuItem.tags.join(", "), itemId: menuItem.id })}
        onAddToAlbum={(albumId) => void addItemToAlbum(menuItem.id, albumId).catch((error) => setLocalError(error instanceof Error ? error.message : "The item could not be added to that album."))}
        onToggleFavorite={() => void updateItem(menuItem, { favorite: !menuItem.favorite })}
        onTrash={() => void trashItem(menuItem)}
        onRestore={() => void restoreItem(menuItem)}
      /> : null}
      {filePickerOpen && canUploadLibrary ? <MistyFilePicker mode="file" multiple title="Add files to this Space" onCancel={() => setFilePickerOpen(false)} onSelect={(path) => { setFilePickerOpen(false); void uploadFiles([path]); }} onSelectMany={(paths) => { setFilePickerOpen(false); void uploadFiles(paths); }}/> : null}
      {selectedItemId ? <LibraryItemViewer spaceId={spaceId} item={displayItems.find((item) => item.id === selectedItemId) ?? items.find((item) => item.id === selectedItemId) ?? null} items={displayItems} allItems={items} assetStack={stackByItemID.get(selectedItemId) ?? null} reauthenticationToken={sensitiveCollectionToken} canEdit={canEditLibrary} canCopy={canCopyLibrary} returnFocusRef={libraryViewerTriggerRef} onCopyEdit={(definition) => setCopiedEditDefinition(structuredClone(definition))} onSetStackCover={setAssetStackCover} onSetStackEffect={setAssetStackEffect} onUngroupStack={ungroupAssetStack} onClose={() => setSelectedItemId("")} onSelect={setSelectedItemId} onUpdate={updateItem} onReplaceItem={replaceItem} onRenditionReady={() => setReloadKey((current) => current + 1)} onTrash={trashItem}/> : null}
      {memoryPlaybackOpen && currentDiscoveryGroup?.kind === "memory" ? <LibraryMemoryPlayback spaceId={spaceId} group={currentDiscoveryGroup} items={visibleItems} onClose={() => setMemoryPlaybackOpen(false)}/> : null}
{albumDialogMode ? <div className="fixed inset-0 z-[2147483000] grid place-items-center bg-black/60 p-6" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !albumSaving) setAlbumDialogMode(""); }}><form ref={albumDialogFocus.dialogRef} className="w-full max-w-sm rounded-2xl border border-[var(--misty-border-strong)] bg-[var(--misty-app-modal-bg,var(--misty-surface))] p-5 shadow-2xl" role="dialog" aria-modal="true" aria-label={albumDialogMode === "create" ? "New album" : "Edit album"} onKeyDown={albumDialogFocus.trapFocus} onSubmit={(event) => void saveAlbum(event)}><div className="flex items-center justify-between gap-4"><h2 className="m-0 text-base font-semibold">{albumDialogMode === "create" ? "New album" : "Edit album"}</h2><button className={iconButtonClass} type="button" disabled={albumSaving} onClick={() => setAlbumDialogMode("")} aria-label="Close album dialog"><X size={15}/></button></div><label className="mt-5 grid gap-2 text-xs font-medium text-[var(--misty-text-muted)]">Name<input className={inputClass} data-dialog-autofocus maxLength={120} value={albumName} onChange={(event) => setAlbumName(event.target.value)}/></label><label className="mt-4 grid gap-2 text-xs font-medium text-[var(--misty-text-muted)]">Description<textarea className={`${inputClass} min-h-20 resize-y py-2`} maxLength={2000} value={albumDescription} onChange={(event) => setAlbumDescription(event.target.value)}/></label>{albumDialogMode === "edit" && visibleItems.length > 0 ? <label className="mt-4 grid gap-2 text-xs font-medium text-[var(--misty-text-muted)]">Cover<select className={inputClass} value={albumCoverItemId} onChange={(event) => setAlbumCoverItemId(event.target.value)}><option value="">Automatic</option>{visibleItems.map((item) => <option value={item.id} key={item.id}>{item.display_name}</option>)}</select></label> : null}<div className="mt-5 flex justify-end gap-2"><button className={secondaryButtonClass} type="button" disabled={albumSaving} onClick={() => setAlbumDialogMode("")}>Cancel</button><button className={primaryButtonClass} type="submit" disabled={albumSaving || !albumName.trim()}>{albumSaving ? "Saving…" : albumDialogMode === "create" ? "Create" : "Save"}</button></div></form></div> : null}
{personDialogMode ? <div className="fixed inset-0 z-[2147483000] grid place-items-center bg-black/60 p-6" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !personSaving) setPersonDialogMode(""); }}><form ref={personDialogFocus.dialogRef} className="w-full max-w-sm rounded-2xl border border-[var(--misty-border-strong)] bg-[var(--misty-app-modal-bg,var(--misty-surface))] p-5 shadow-2xl" role="dialog" aria-modal="true" aria-label="People and Pets" onKeyDown={personDialogFocus.trapFocus} onSubmit={(event) => void savePerson(event)}><div className="flex items-center justify-between gap-4"><h2 className="m-0 text-base font-semibold">{personDialogMode === "create" ? personKind === "pet" ? "New pet" : "New person" : personKind === "pet" ? "Edit pet" : "Edit person"}</h2><button className={iconButtonClass} type="button" disabled={personSaving} onClick={() => setPersonDialogMode("")} aria-label="Close People & Pets dialog"><X size={15}/></button></div><label className="mt-5 grid gap-2 text-xs font-medium text-[var(--misty-text-muted)]">Name<input className={inputClass} data-dialog-autofocus maxLength={120} value={personName} onChange={(event) => setPersonName(event.target.value)}/></label>{personDialogMode === "edit" && visibleItems.length > 0 ? <label className="mt-4 grid gap-2 text-xs font-medium text-[var(--misty-text-muted)]">Cover<select className={inputClass} value={personCoverItemId} onChange={(event) => setPersonCoverItemId(event.target.value)}><option value="">Automatic</option>{visibleItems.map((item) => <option value={item.id} key={item.id}>{item.display_name}</option>)}</select></label> : null}<div className="mt-5 flex justify-end gap-2"><button className={secondaryButtonClass} type="button" disabled={personSaving} onClick={() => setPersonDialogMode("")}>Cancel</button><button className={primaryButtonClass} type="submit" disabled={personSaving}>{personSaving ? "Saving…" : personDialogMode === "create" ? "Create" : "Save"}</button></div></form></div> : null}
{metadataDialogAction ? <div className="fixed inset-0 z-[2147483000] grid place-items-center bg-black/60 p-6" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !bulkSaving) setMetadataDialogAction(""); }}><form ref={metadataDialogFocus.dialogRef} className="w-full max-w-sm rounded-2xl border border-[var(--misty-border-strong)] bg-[var(--misty-app-modal-bg,var(--misty-surface))] p-5 shadow-2xl" role="dialog" aria-modal="true" aria-label="Adjust selected item metadata" onKeyDown={metadataDialogFocus.trapFocus} onSubmit={(event) => void saveBulkMetadata(event)}><div className="flex items-center justify-between gap-4"><h2 className="m-0 text-base font-semibold">{metadataDialogAction === "add_tags" ? "Add tags" : metadataDialogAction === "remove_tags" ? "Remove tags" : metadataDialogAction === "set_date" ? "Adjust date" : "Set location"}</h2><button className={iconButtonClass} type="button" disabled={bulkSaving} onClick={() => setMetadataDialogAction("")} aria-label="Close metadata dialog"><X size={15}/></button></div><p className="mb-0 mt-1 text-xs text-[var(--misty-text-subtle)]">{selectedItems.length} selected item{selectedItems.length === 1 ? "" : "s"}</p>{metadataDialogAction === "add_tags" || metadataDialogAction === "remove_tags" ? <label className="mt-5 grid gap-2 text-xs font-medium text-[var(--misty-text-muted)]">Tags<input className={inputClass} data-dialog-autofocus value={metadataTags} onChange={(event) => setMetadataTags(event.target.value)} placeholder="travel, family"/></label> : metadataDialogAction === "set_date" ? <label className="mt-5 grid gap-2 text-xs font-medium text-[var(--misty-text-muted)]">Date and time<input className={inputClass} data-dialog-autofocus type="datetime-local" value={metadataDate} onChange={(event) => setMetadataDate(event.target.value)}/></label> : <div className="mt-5 grid gap-4"><label className="grid gap-2 text-xs font-medium text-[var(--misty-text-muted)]">Place name<input className={inputClass} data-dialog-autofocus value={metadataLocationName} onChange={(event) => setMetadataLocationName(event.target.value)} placeholder="Big Sur"/></label><div className="grid grid-cols-2 gap-3"><label className="grid gap-2 text-xs font-medium text-[var(--misty-text-muted)]">Latitude<input className={inputClass} inputMode="decimal" value={metadataLatitude} onChange={(event) => setMetadataLatitude(event.target.value)} placeholder="36.2704"/></label><label className="grid gap-2 text-xs font-medium text-[var(--misty-text-muted)]">Longitude<input className={inputClass} inputMode="decimal" value={metadataLongitude} onChange={(event) => setMetadataLongitude(event.target.value)} placeholder="-121.8079"/></label></div></div>}<div className="mt-5 flex justify-end gap-2"><button className={secondaryButtonClass} type="button" disabled={bulkSaving} onClick={() => setMetadataDialogAction("")}>Cancel</button><button className={primaryButtonClass} type="submit" disabled={bulkSaving}>{bulkSaving ? "Saving…" : "Apply"}</button></div></form></div> : null}
      {textDialog ? <div className="fixed inset-0 z-[2147483100] grid place-items-center bg-black/60 p-6" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !textDialogSaving) setTextDialog(null); }}><form ref={textDialogFocus.dialogRef} className="w-full max-w-sm rounded-2xl border border-[var(--misty-border-strong)] bg-[var(--misty-app-modal-bg,var(--misty-surface))] p-5 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="library-text-dialog-title" onKeyDown={textDialogFocus.trapFocus} onSubmit={(event) => void submitTextDialog(event)}><div className="flex items-center justify-between gap-4"><h2 className="m-0 text-base font-semibold" id="library-text-dialog-title">{textDialog.title}</h2><button className={iconButtonClass} type="button" disabled={textDialogSaving} onClick={() => setTextDialog(null)} aria-label="Close dialog"><X size={15}/></button></div><label className="mt-5 grid gap-2 text-xs font-medium text-[var(--misty-text-muted)]">{textDialog.primaryLabel}<input className={inputClass} data-dialog-autofocus maxLength={textDialog.kind === "edit-tags" ? 1000 : 255} value={textDialog.primaryValue} onChange={(event) => setTextDialog((current) => current ? { ...current, primaryValue: event.target.value } : current)}/></label>{textDialog.secondaryLabel ? <label className="mt-4 grid gap-2 text-xs font-medium text-[var(--misty-text-muted)]">{textDialog.secondaryLabel}<input className={inputClass} maxLength={120} value={textDialog.secondaryValue ?? ""} onChange={(event) => setTextDialog((current) => current ? { ...current, secondaryValue: event.target.value } : current)}/></label> : null}{textDialogError ? <p className="mb-0 mt-3 rounded-xl border border-red-400/20 bg-red-950/20 px-3 py-2 text-xs text-red-200" role="alert">{textDialogError}</p> : null}<div className="mt-5 flex justify-end gap-2"><button className={secondaryButtonClass} type="button" disabled={textDialogSaving} onClick={() => setTextDialog(null)}>Cancel</button><button className={primaryButtonClass} type="submit" disabled={textDialogSaving || textDialog.kind !== "edit-tags" && !textDialog.primaryValue.trim() || Boolean(textDialog.secondaryLabel && !textDialog.secondaryValue?.trim())}>{textDialogSaving ? "Saving…" : textDialog.kind === "create-folder" || textDialog.kind === "create-group" ? "Create" : "Save"}</button></div></form></div> : null}
{unlockScope ? <div className="fixed inset-0 z-[2147483200] grid place-items-center bg-black/70 p-6" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) closeSensitiveUnlock(); }}><form ref={unlockDialogFocus.dialogRef} className="w-full max-w-sm rounded-2xl border border-[var(--misty-border-strong)] bg-[var(--misty-app-modal-bg,var(--misty-surface))] p-5 shadow-2xl" role="dialog" aria-modal="true" aria-label="Unlock protected Library action" onKeyDown={unlockDialogFocus.trapFocus} onSubmit={(event) => void submitSensitiveUnlock(event)}><div className="flex items-center justify-between gap-4"><h2 className="m-0 text-base font-semibold">Unlock {unlockScope === "hidden" ? "Hidden" : "Recently Deleted"}</h2><button className={iconButtonClass} type="button" disabled={unlockSaving} onClick={closeSensitiveUnlock} aria-label="Close unlock dialog"><X size={15}/></button></div><label className="mt-5 grid gap-2 text-xs font-medium text-[var(--misty-text-muted)]">Misty password<input className={inputClass} data-dialog-autofocus type="password" autoComplete="current-password" value={unlockPassword} onChange={(event) => setUnlockPassword(event.target.value)}/></label>{localError ? <p className="mb-0 mt-3 text-xs text-red-200" role="alert">{localError}</p> : null}<div className="mt-5 flex justify-end gap-2"><button className={secondaryButtonClass} type="button" disabled={unlockSaving} onClick={closeSensitiveUnlock}>Cancel</button><button className={primaryButtonClass} type="submit" disabled={unlockSaving || !unlockPassword}>{unlockSaving ? "Unlocking…" : "Unlock"}</button></div></form></div> : null}
    </div>
    </LibraryCanEditContext.Provider>
  );
}

function LibraryMemoryPlayback({ spaceId, group, items, onClose }: { spaceId: string; group: LibraryDiscoveryGroup; items: SpaceLibraryItem[]; onClose: () => void }) {
  const musicRef = useRef<HTMLAudioElement | null>(null);
  const playbackDialog = useDialogFocus<HTMLDivElement>(true);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [contentUrl, setContentUrl] = useState("");
  const [musicUrl, setMusicUrl] = useState("");
  const [contentError, setContentError] = useState("");
  const item = items[index] ?? null;
  const mimeType = item ? libraryItemMIME(item) : "application/octet-stream";
  const isVideo = mimeType.startsWith("video/");
  const isVisualImage = mimeType.startsWith("image/") || !isVideo && Number(item?.file.intrinsic_metadata.width ?? 0) > 0;

  useEffect(() => {
    let current = true;
    let objectUrl = "";
    setContentUrl("");
    setContentError("");
    if (!item) return () => { current = false; };
    const request = isVisualImage ? spacesApi.libraryPreview(spaceId, item.id, "", item.version).catch(() => spacesApi.libraryContent(spaceId, item.id)) : spacesApi.libraryContent(spaceId, item.id);
    void request.then((blob) => {
      if (!current) return;
      objectUrl = URL.createObjectURL(blob);
      setContentUrl(objectUrl);
    }).catch(() => current && setContentError("This item could not be played."));
    return () => {
      current = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [isVisualImage, item?.id, item?.version, spaceId]);

  useEffect(() => {
    let current = true;
    let objectUrl = "";
    setMusicUrl("");
    if (!group.music_item_id) return () => { current = false; };
    void spacesApi.libraryContent(spaceId, group.music_item_id).then((blob) => {
      if (!current) return;
      objectUrl = URL.createObjectURL(blob);
      setMusicUrl(objectUrl);
    }).catch(() => undefined);
    return () => {
      current = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [group.music_item_id, spaceId]);

  useEffect(() => {
    if (!playing || isVideo || !contentUrl || items.length < 2) return;
    const timer = window.setTimeout(() => setIndex((current) => (current + 1) % items.length), (group.playback_seconds ?? 4.5) * 1000);
    return () => window.clearTimeout(timer);
  }, [contentUrl, group.playback_seconds, isVideo, items.length, playing]);

  useEffect(() => {
    if (!musicRef.current) return;
    if (playing) void musicRef.current.play().catch(() => undefined);
    else musicRef.current.pause();
  }, [musicUrl, playing]);

  if (!item) return null;
  const previous = () => setIndex((current) => (current - 1 + items.length) % items.length);
  const next = () => setIndex((current) => (current + 1) % items.length);
  return <div ref={playbackDialog.dialogRef} className="fixed inset-0 z-[2147483100] flex flex-col bg-black text-white" role="dialog" aria-modal="true" aria-label={`Playing ${group.title}`} onKeyDown={(event) => {
    if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
    playbackDialog.trapFocus(event);
    if ((event.target as HTMLElement).matches("button, input, textarea, select, [contenteditable='true']")) return;
    if (event.key === "ArrowLeft") previous();
    else if (event.key === "ArrowRight") next();
    else if (event.key === " ") { event.preventDefault(); setPlaying((current) => !current); }
  }}>
    <div className="flex items-center gap-1 px-5 pt-4">{items.map((candidate, candidateIndex) => <button className="h-1 flex-1 overflow-hidden rounded-full border-0 bg-white/20 p-0" type="button" key={candidate.id} onClick={() => setIndex(candidateIndex)} aria-label={`Show item ${candidateIndex + 1}`}><span className={`block h-full bg-white transition-[width] duration-300 ${candidateIndex < index ? "w-full" : candidateIndex === index ? "w-1/2" : "w-0"}`}/></button>)}</div>
    <header className="flex items-center justify-between gap-4 px-5 py-4"><div className="min-w-0"><h2 className="m-0 truncate text-base font-semibold">{group.title}</h2><p className="mb-0 mt-1 truncate text-xs text-white/55">{group.subtitle}</p></div><button className="grid size-9 shrink-0 place-items-center rounded-full border-0 bg-white/10 text-white hover:bg-white/20" data-dialog-autofocus type="button" onClick={onClose} aria-label="Close memory"><X size={18}/></button></header>
    <main className="relative grid min-h-0 flex-1 place-items-center overflow-hidden bg-[radial-gradient(circle_at_center,#252525,#050505_72%)]">
      {musicUrl ? <audio ref={musicRef} className="hidden" src={musicUrl} autoPlay={playing} loop/> : null}
      {contentUrl ? isVideo ? <video className="max-h-full max-w-full object-contain" key={`${item.id}:${playing}`} src={contentUrl} autoPlay={playing} controls={false} muted={Boolean(musicUrl)} playsInline onEnded={next}/> : isVisualImage ? <img className="max-h-full max-w-full object-contain" src={contentUrl} alt={item.display_name}/> : <div className="grid place-items-center gap-3 text-white/60"><File size={48}/><span className="text-sm">{item.display_name}</span></div> : <div className="text-sm text-white/50">{contentError || "Loading…"}</div>}
      {items.length > 1 ? <><button className="absolute left-5 grid size-10 place-items-center rounded-full border-0 bg-black/35 text-white opacity-70 backdrop-blur hover:opacity-100" type="button" onClick={previous} aria-label="Previous"><ChevronLeft size={22}/></button><button className="absolute right-5 grid size-10 place-items-center rounded-full border-0 bg-black/35 text-white opacity-70 backdrop-blur hover:opacity-100" type="button" onClick={next} aria-label="Next"><ChevronRight size={22}/></button></> : null}
      <div className="absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-full bg-black/45 px-4 py-2 backdrop-blur"><button className="grid size-8 place-items-center border-0 bg-transparent text-white/75 hover:text-white" type="button" onClick={previous} aria-label="Previous"><SkipBack size={17}/></button><button className="grid size-10 place-items-center rounded-full border-0 bg-white text-black" type="button" onClick={() => setPlaying((current) => !current)} aria-label={playing ? "Pause" : "Play"}>{playing ? <Pause size={18}/> : <Play size={18}/>}</button><button className="grid size-8 place-items-center border-0 bg-transparent text-white/75 hover:text-white" type="button" onClick={next} aria-label="Next"><SkipForward size={17}/></button></div>
    </main>
    <footer className="px-5 py-3 text-center"><p className="m-0 truncate text-xs text-white/70">{item.display_name} · {index + 1} of {items.length}</p></footer>
  </div>;
}

function LibraryItemViewer({
  spaceId,
  item,
  items,
  allItems,
  assetStack,
  reauthenticationToken,
  canEdit,
  canCopy,
  returnFocusRef,
  onCopyEdit,
  onSetStackCover,
  onSetStackEffect,
  onUngroupStack,
  onClose,
  onSelect,
  onUpdate,
  onReplaceItem,
  onRenditionReady,
  onTrash,
}: {
  spaceId: string;
  item: SpaceLibraryItem | null;
  items: SpaceLibraryItem[];
  allItems: SpaceLibraryItem[];
  assetStack: LibraryAssetStack | null;
  reauthenticationToken: string;
  canEdit: boolean;
  canCopy: boolean;
  returnFocusRef: RefObject<HTMLElement | null>;
  onCopyEdit: (definition: LibraryEditDefinition) => void;
  onSetStackCover: (stack: LibraryAssetStack, coverItemID: string) => Promise<void>;
  onSetStackEffect: (stack: LibraryAssetStack, effect: LibraryAssetStack["effect"]) => Promise<void>;
  onUngroupStack: (stack: LibraryAssetStack) => Promise<void>;
  onClose: () => void;
  onSelect: (itemId: string) => void;
  onUpdate: (item: SpaceLibraryItem, patch: Partial<Pick<SpaceLibraryItem, "display_name" | "caption" | "favorite" | "hidden" | "tags">>) => Promise<SpaceLibraryItem | null>;
  onReplaceItem: (item: SpaceLibraryItem) => void;
  onRenditionReady: () => void;
  onTrash: (item: SpaceLibraryItem) => Promise<boolean>;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const viewerDialog = useDialogFocus<HTMLElement>(true, returnFocusRef);
  const mediaAreaRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const bounceFrameRef = useRef(0);
  const [contentUrl, setContentUrl] = useState("");
  const [contentError, setContentError] = useState("");
  const [contentLoading, setContentLoading] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [caption, setCaption] = useState("");
  const [tags, setTags] = useState("");
  const [saving, setSaving] = useState(false);
  const [editVersions, setEditVersions] = useState<LibraryEditVersion[]>([]);
  const [editVersionsLoading, setEditVersionsLoading] = useState(false);
  const [editingAvailable, setEditingAvailable] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState<LibraryEditDefinition>(() => defaultLibraryEdit());
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const [stackMemberID, setStackMemberID] = useState("");
  const index = item ? items.findIndex((candidate) => candidate.id === item.id) : -1;
  const metadata = item?.file.intrinsic_metadata ?? {};
  const mimeType = item ? libraryItemMIME(item) : "application/octet-stream";
  const isImage = mimeType.startsWith("image/") || !mimeType.startsWith("video/") && Number(metadata.width ?? 0) > 0 && Number(metadata.height ?? 0) > 0;
  const isVideo = /^video\//.test(mimeType);
  const isAudio = /^audio\//.test(mimeType);
  const activeEdit = editVersions.find((version) => version.is_current) ?? null;
  const appliedEdit = editing ? editDraft : normalizeLibraryEdit(activeEdit?.edit_definition);
  const renditionReady = activeEdit?.rendition_state === "ready";
  const mediaStyle = renditionReady && !editing ? undefined : libraryEditStyle(appliedEdit);
  const stackMediaID = stackMemberID || item?.id || "";
  const stackMediaItem = allItems.find((candidate) => candidate.id === stackMediaID) ?? (item?.id === stackMediaID ? item : null);
  const stackMediaMember = assetStack?.members.find((member) => member.item_id === stackMediaID);
  const stackMediaMetadata = stackMediaItem?.file.intrinsic_metadata ?? {};
  const stackMediaMIME = stackMediaItem ? libraryItemMIME(stackMediaItem) : String(stackMediaMember?.mime_type ?? "application/octet-stream").split(";")[0].toLowerCase();
  const contentIsImage = stackMediaMIME.startsWith("image/") || !stackMediaMIME.startsWith("video/") && Number(stackMediaMetadata.width ?? 0) > 0 && Number(stackMediaMetadata.height ?? 0) > 0;
  const contentIsVideo = stackMediaMIME.startsWith("video/");
  const contentIsAudio = stackMediaMIME.startsWith("audio/");

  useEffect(() => {
    setStackMemberID("");
  }, [assetStack?.id, item?.id]);

  useEffect(() => () => window.cancelAnimationFrame(bounceFrameRef.current), []);

  useEffect(() => {
    if (!item) return;
    setDisplayName(item.display_name);
    setCaption(item.caption);
    setTags(item.tags.join(", "));
  }, [item?.id, item?.version]);

  useEffect(() => {
    if (!item || !isImage && !isVideo) {
      setEditVersions([]);
      setEditVersionsLoading(false);
      setEditingAvailable(false);
      return;
    }
    let current = true;
    setEditVersionsLoading(true);
    void spacesApi.editVersions(spaceId, item.id, reauthenticationToken).then((result) => {
      if (!current) return;
      setEditVersions(result.versions);
      setEditingAvailable(true);
      const selected = result.versions.find((version) => version.is_current);
      setEditDraft(normalizeLibraryEdit(selected?.edit_definition));
    }).catch(() => {
      if (!current) return;
      setEditVersions([]);
      setEditingAvailable(false);
    }).finally(() => {
      if (current) setEditVersionsLoading(false);
    });
    return () => { current = false; };
  }, [isImage, isVideo, item?.id, item?.version, reauthenticationToken, spaceId]);

  useEffect(() => {
    if (!item || !editVersions.some((version) => version.rendition_state === "queued" || version.rendition_state === "processing")) return;
    let current = true;
    const refresh = () => void spacesApi.editVersions(spaceId, item.id, reauthenticationToken).then((result) => {
      if (!current) return;
      const newlyReady = result.versions.some((version) => version.rendition_state === "ready" && editVersions.some((previous) => previous.id === version.id && previous.rendition_state !== "ready"));
      setEditVersions(result.versions);
      if (newlyReady) onRenditionReady();
    }).catch(() => undefined);
    const timer = window.setInterval(refresh, 1500);
    return () => { current = false; window.clearInterval(timer); };
  }, [editVersions, item?.id, onRenditionReady, reauthenticationToken, spaceId]);

  useEffect(() => {
    if (!item || !stackMediaID) {
      setContentUrl("");
      setContentError("");
      return;
    }
    let current = true;
    let objectUrl = "";
    setContentLoading(true);
    setContentError("");
    const showingCover = stackMediaID === item.id;
    const longExposureMotionID = assetStack?.kind === "live_photo" && assetStack.effect === "long_exposure" && showingCover ? assetStack.motion_item_id : "";
    const request = longExposureMotionID
      ? spacesApi.libraryContent(spaceId, longExposureMotionID, reauthenticationToken).then(createLongExposureImage)
      : (editing || isImage) && showingCover
		? contentIsImage ? spacesApi.libraryOriginalPreview(spaceId, stackMediaID, reauthenticationToken, stackMediaItem?.version ?? item.version).catch(() => spacesApi.libraryOriginalContent(spaceId, stackMediaID, reauthenticationToken)) : spacesApi.libraryOriginalContent(spaceId, stackMediaID, reauthenticationToken)
		: contentIsImage ? spacesApi.libraryPreview(spaceId, stackMediaID, reauthenticationToken, stackMediaItem?.version ?? item.version).catch(() => spacesApi.libraryContent(spaceId, stackMediaID, reauthenticationToken)) : spacesApi.libraryContent(spaceId, stackMediaID, reauthenticationToken);
    void request.then((blob) => {
      if (!current) return;
      objectUrl = URL.createObjectURL(blob);
      setContentUrl(objectUrl);
    }).catch((error: unknown) => current && setContentError(error instanceof Error ? error.message : "The file reader could not load this item.")).finally(() => current && setContentLoading(false));
    return () => {
      current = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [activeEdit?.rendition_state, assetStack?.effect, assetStack?.kind, assetStack?.motion_item_id, contentIsAudio, contentIsImage, contentIsVideo, editing, isImage, item?.id, item?.version, reauthenticationToken, spaceId, stackMediaID, stackMediaItem?.version]);

  useEffect(() => {
    if (isImage) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      if (event.key === "ArrowLeft" && index > 0) onSelect(items[index - 1].id);
      if (event.key === "ArrowRight" && index >= 0 && index < items.length - 1) onSelect(items[index + 1].id);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [index, isImage, items, onClose, onSelect]);

  if (!item) return null;

  const saveMetadata = async (event: FormEvent) => {
    event.preventDefault();
    const name = displayName.trim();
    if (!canEdit || !name || saving) return;
    setSaving(true);
    try {
      await onUpdate(item, { display_name: name, caption: caption.trim(), tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean) });
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async (definition: LibraryEditDefinition = editDraft) => {
    if (!canEdit || editSaving) return;
    setEditSaving(true);
    setEditError("");
    try {
      const result = await spacesApi.createEditVersion(spaceId, item, definition, reauthenticationToken);
      onReplaceItem(result.item);
      if (result.edit) {
        let savedVersion = { ...result.edit, is_current: true };
        setEditVersions((current) => [savedVersion, ...current.map((version) => ({ ...version, is_current: false }))]);
        try {
          const rendition = await spacesApi.renderEditVersion(spaceId, item.id, result.edit.id, 0, reauthenticationToken);
          savedVersion = { ...savedVersion, rendition_state: rendition.state };
          setEditVersions((current) => current.map((version) => version.id === savedVersion.id ? savedVersion : version));
        } catch (error) {
          setEditError(error instanceof Error ? `The edit was saved, but its media rendition could not start: ${error.message}` : "The edit was saved, but its media rendition could not start.");
        }
      }
      setEditing(false);
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "Edit could not be saved.");
    } finally {
      setEditSaving(false);
    }
  };

  const saveAsCopy = async (definition: LibraryEditDefinition = editDraft) => {
    if (!canEdit || editSaving) return;
    setEditSaving(true); setEditError("");
    try {
      const duplicated = await spacesApi.duplicateLibraryItems(spaceId, [item.id], reauthenticationToken);
      const copy = duplicated.items[0];
      if ((isImage || editing) && copy) {
        const edited = await spacesApi.createEditVersion(spaceId, copy, definition, reauthenticationToken);
        if (edited.edit) await spacesApi.renderEditVersion(spaceId, copy.id, edited.edit.id, 0, reauthenticationToken);
      }
      onRenditionReady();
    }
    catch (error) { setEditError(error instanceof Error ? error.message : "A copy could not be saved."); }
    finally { setEditSaving(false); }
  };

  const copyCurrentItem = async (target: SpaceLibraryItem = item) => {
    if (!canCopy) return;
    setEditError("");
    try {
      await copyLibraryItemsToClipboard(spaceId, [target], reauthenticationToken);
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "The Library item could not be copied.");
    }
  };

  const renderEdit = async (editID: string) => {
    if (!canEdit || editSaving) return;
    setEditSaving(true);
    setEditError("");
    try {
      const rendition = await spacesApi.renderEditVersion(spaceId, item.id, editID, 0, reauthenticationToken);
      setEditVersions((current) => current.map((version) => version.id === editID ? { ...version, rendition_state: rendition.state, rendition_error_code: undefined } : version));
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "The edit rendition could not start.");
    } finally {
      setEditSaving(false);
    }
  };

  const selectEdit = async (editID = "") => {
    if (!canEdit || editSaving) return;
    setEditSaving(true);
    setEditError("");
    try {
      const result = await spacesApi.selectEditVersion(spaceId, item, editID, reauthenticationToken);
      onReplaceItem(result.item);
      setEditVersions((current) => current.map((version) => ({ ...version, is_current: version.id === editID })));
      const selected = editVersions.find((version) => version.id === editID);
      setEditDraft(normalizeLibraryEdit(selected?.edit_definition));
      setEditing(false);
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "Version could not be selected.");
    } finally {
      setEditSaving(false);
    }
  };

  const deleteEdit = async (editID: string) => {
    if (!canEdit || editSaving || !await confirmAction("Delete this edit version?")) return;
    setEditSaving(true);
    try {
      await spacesApi.deleteEditVersion(spaceId, item.id, editID, reauthenticationToken);
      setEditVersions((current) => current.filter((version) => version.id !== editID));
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "Version could not be deleted.");
    } finally {
      setEditSaving(false);
    }
  };

  const beginEditing = () => {
    if (!canEdit) return;
    setEditDraft(normalizeLibraryEdit(activeEdit?.edit_definition));
    setEditing(true);
    setEditError("");
  };

  const handleVideoTime = () => {
    if (!videoRef.current) return;
    videoRef.current.playbackRate = appliedEdit.playback_speed || 1;
    videoRef.current.muted = appliedEdit.mute;
    const trim = appliedEdit.trim;
    if (!trim) return;
    if (videoRef.current.currentTime < trim.start) videoRef.current.currentTime = trim.start;
    if (videoRef.current.currentTime >= trim.end) videoRef.current.pause();
  };

  const handleVideoEnded = () => {
    const video = videoRef.current;
    if (!video || assetStack?.kind !== "live_photo" || assetStack.effect !== "bounce") return;
    const reverse = () => {
      if (!videoRef.current) return;
      if (videoRef.current.currentTime <= .04) {
        videoRef.current.currentTime = 0;
        void videoRef.current.play();
        return;
      }
      videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - .04);
      bounceFrameRef.current = window.requestAnimationFrame(reverse);
    };
    reverse();
  };

  if (isImage) return <GlobalImageEditor
    sourceKey={`${item.id}:${activeEdit?.id ?? "original"}`}
    name={item.display_name}
    url={contentUrl}
    indexLabel={`${index + 1} of ${items.length}`}
    tags={item.tags}
    initialEdit={editDraft}
    outputMimeType={mimeType === "image/jpeg" ? "image/jpeg" : mimeType === "image/webp" ? "image/webp" : "image/png"}
    loading={contentLoading || editVersionsLoading}
    error={contentError || undefined}
    readonly={!canEdit}
    onClose={onClose}
    onCancel={onClose}
    onSave={async (definition) => { await saveEdit(definition); }}
    onSaveAsCopy={async (definition) => { await saveAsCopy(definition); }}
    onSaveTags={async (nextTags) => { await onUpdate(item, { tags: nextTags }); }}
  />;

  return (
    <div className="fixed inset-0 z-[2147483100] grid place-items-center bg-black/80 p-4 backdrop-blur-sm" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <section ref={viewerDialog.dialogRef} className="grid h-[min(860px,calc(100dvh-32px))] min-h-0 min-w-0 w-[min(1320px,calc(100vw-32px))] grid-cols-[minmax(0,1fr)_minmax(300px,340px)] grid-rows-[56px_minmax(0,1fr)] overflow-hidden rounded-2xl border border-[var(--misty-border-strong)] bg-[var(--misty-app-page-bg,#07090b)] shadow-2xl" role="dialog" aria-modal="true" aria-label={item.display_name} onKeyDown={(event) => {
        const target = event.target as HTMLElement | null;
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "c" && !target?.matches("input, textarea, select, [contenteditable='true']")) {
          event.preventDefault();
          void copyCurrentItem();
          return;
        }
        viewerDialog.trapFocus(event);
      }}>
        <header className="relative z-20 col-span-2 flex min-w-0 items-center justify-between gap-4 border-b border-[var(--misty-border-soft)] bg-[var(--misty-app-page-bg,#07090b)] px-4">
          <div className="min-w-0"><p className="m-0 truncate text-sm font-medium">{item.display_name}</p><p className="m-0 mt-0.5 text-[10px] text-[var(--misty-text-subtle)]">{index + 1} of {items.length}</p></div>
          <div className="flex min-w-0 shrink-0 items-center gap-1 overflow-x-auto py-1">
            {canEdit && assetStack && stackMediaID !== assetStack.cover_item_id && stackMediaMember?.role !== "motion" && stackMediaMember?.role !== "raw" ? <button className={smallButtonClass} type="button" onClick={() => void onSetStackCover(assetStack, stackMediaID)}>Make key photo</button> : null}
            {canEdit && assetStack ? <button className={smallButtonClass} type="button" onClick={() => void onUngroupStack(assetStack)}>Ungroup</button> : null}
            {canEdit && activeEdit ? <button className={smallButtonClass} type="button" onClick={() => onCopyEdit(normalizeLibraryEdit(activeEdit.edit_definition))}><Copy size={12}/>Copy edits</button> : null}
            {canEdit ? <button className={smallButtonClass} type="button" disabled={editSaving} onClick={() => void saveAsCopy()}><Copy size={12}/>Save as copy</button> : null}
            {canEdit && editing ? <button className={primaryButtonClass} type="button" disabled={editSaving} onClick={() => void saveEdit()}>{editSaving ? "Saving…" : "Save"}</button> : null}
            {canEdit ? <button className={iconButtonClass} type="button" onClick={() => void onUpdate(item, { favorite: !item.favorite })} aria-label={item.favorite ? "Remove favorite" : "Favorite"} title={item.favorite ? "Remove favorite" : "Favorite"}><Star size={15} fill={item.favorite ? "currentColor" : "none"}/></button> : null}
            {canEdit ? <button className={iconButtonClass} type="button" onClick={() => void onUpdate(item, { hidden: !item.hidden })} aria-label={item.hidden ? "Unhide" : "Hide"} title={item.hidden ? "Unhide" : "Hide"}><EyeOff size={15}/></button> : null}
            {canEdit && editingAvailable ? <button className={iconButtonClass} type="button" onClick={beginEditing} aria-label="Edit" title="Edit"><SlidersHorizontal size={15}/></button> : null}
            {canCopy ? <button className={iconButtonClass} type="button" disabled={Boolean(activeEdit) && !renditionReady} onClick={() => void copyCurrentItem()} aria-label={activeEdit ? renditionReady ? "Copy edited media" : "Edited media is rendering" : "Copy to clipboard"} title={activeEdit ? renditionReady ? "Copy edited media" : "Edited media is rendering" : "Copy to clipboard"}><ClipboardCopy size={15}/></button> : null}
            {canEdit ? <button className={iconButtonClass} type="button" onClick={() => void onTrash(item)} aria-label="Move to Recently Deleted" title="Move to Recently Deleted"><Trash2 size={15}/></button> : null}
            <button className={iconButtonClass} data-dialog-autofocus type="button" onClick={onClose} aria-label="Close"><X size={15}/></button>
          </div>
        </header>
        <div ref={mediaAreaRef} className="relative isolate min-h-0 min-w-0 overflow-hidden bg-black/35">
          <div className="absolute inset-6 flex min-h-0 min-w-0 items-center justify-center overflow-hidden">
            <EmbeddedUniversalPreview name={stackMediaItem?.display_name ?? stackMediaMember?.display_name ?? item.display_name} mimeType={stackMediaMIME} url={contentUrl} loading={contentLoading} error={contentError} imageRef={imageRef} videoRef={videoRef} mediaStyle={stackMediaID === item.id ? mediaStyle : undefined} autoPlay={assetStack?.kind === "live_photo"} loop={assetStack?.kind === "live_photo" && assetStack.effect === "loop"} onVideoEnded={handleVideoEnded} onVideoMetadata={handleVideoTime} onVideoTime={handleVideoTime} fallbackAction={canCopy && stackMediaItem ? <button className={secondaryButtonClass} type="button" onClick={() => void copyCurrentItem(stackMediaItem)}><ClipboardCopy size={14}/>Copy</button> : undefined}/>
          </div>
          {assetStack ? <div className="absolute left-4 top-4 flex items-center gap-1 rounded-xl border border-white/10 bg-black/55 p-1 text-white backdrop-blur-sm">{assetStack.members.map((member, memberIndex) => <button className={`rounded-lg border-0 px-2 py-1 text-[10px] font-medium ${member.item_id === stackMediaID ? "bg-white text-black" : "bg-transparent text-white/75 hover:bg-white/10"}`} type="button" key={member.item_id} onClick={() => setStackMemberID(member.item_id === item.id ? "" : member.item_id)}>{assetStack.kind === "live_photo" ? member.role === "motion" ? <><Play className="mr-1 inline" size={10}/>Motion</> : "Still" : assetStack.kind === "raw_pair" ? member.role === "raw" ? "RAW" : "Rendered" : memberIndex + 1}</button>)}</div> : null}
          {canEdit && assetStack?.kind === "live_photo" ? <div className="absolute left-4 top-16 flex items-center gap-1 rounded-xl border border-white/10 bg-black/55 p-1 text-white backdrop-blur-sm">{(["still", "loop", "bounce", "long_exposure"] as const).map((effect) => <button className={`rounded-lg border-0 px-2 py-1 text-[10px] font-medium ${assetStack.effect === effect ? "bg-white text-black" : "bg-transparent text-white/75 hover:bg-white/10"}`} type="button" key={effect} onClick={() => void onSetStackEffect(assetStack, effect)}>{effect === "long_exposure" ? "Long Exposure" : effect[0].toUpperCase() + effect.slice(1)}</button>)}</div> : null}
          {items.length > 1 ? <>
            <button className="absolute left-4 top-1/2 z-20 grid size-10 -translate-y-1/2 place-items-center rounded-full border border-white/10 bg-black/45 text-white disabled:opacity-20" type="button" disabled={index <= 0} onClick={() => index > 0 && onSelect(items[index - 1].id)} aria-label="Previous item"><ChevronLeft size={20}/></button>
            <button className="absolute right-4 top-1/2 z-20 grid size-10 -translate-y-1/2 place-items-center rounded-full border border-white/10 bg-black/45 text-white disabled:opacity-20" type="button" disabled={index < 0 || index >= items.length - 1} onClick={() => index >= 0 && index < items.length - 1 && onSelect(items[index + 1].id)} aria-label="Next item"><ChevronRight size={20}/></button>
          </> : null}
        </div>
        <aside className="relative z-10 min-h-0 min-w-0 overflow-y-auto border-l border-[var(--misty-border-soft)] bg-[var(--misty-app-pane-bg,var(--misty-surface))] p-5">
          {editing ? <section className="mb-6 border-b border-[var(--misty-border-soft)] pb-5"><div className="flex items-center justify-between"><h3 className="m-0 text-sm">Edit</h3><button className={smallButtonClass} type="button" onClick={() => setEditDraft(defaultLibraryEdit())}>Reset</button></div><div className="mt-4 flex flex-wrap gap-2"><button className={smallButtonClass} type="button" onClick={() => setEditDraft((current) => ({ ...current, rotation: ((current.rotation + 90) % 360) as LibraryEditDefinition["rotation"] }))}><RotateCw size={12}/>Rotate</button><button className={smallButtonClass} type="button" onClick={() => setEditDraft((current) => ({ ...current, flip_horizontal: !current.flip_horizontal }))}>Flip H</button><button className={smallButtonClass} type="button" onClick={() => setEditDraft((current) => ({ ...current, flip_vertical: !current.flip_vertical }))}>Flip V</button><button className={smallButtonClass} type="button" onClick={() => setEditDraft((current) => ({ ...current, auto_enhance: !current.auto_enhance }))}>{editDraft.auto_enhance ? "Auto on" : "Auto"}</button></div><label className="mt-4 grid gap-1.5 text-[10px] font-medium capitalize text-[var(--misty-text-subtle)]">Filter<select className={inputClass} value={editDraft.filter} onChange={(event) => setEditDraft((current) => ({ ...current, filter: event.target.value as LibraryEditDefinition["filter"] }))}><option value="">None</option><option value="vivid">Vivid</option><option value="dramatic">Dramatic</option><option value="warm">Warm</option><option value="cool">Cool</option><option value="mono">Mono</option><option value="noir">Noir</option></select></label><LibraryEditRange label="Brightness" value={editDraft.brightness} min={0} max={2} step={0.05} onChange={(value) => setEditDraft((current) => ({ ...current, brightness: value }))}/><LibraryEditRange label="Contrast" value={editDraft.contrast} min={0} max={2} step={0.05} onChange={(value) => setEditDraft((current) => ({ ...current, contrast: value }))}/><LibraryEditRange label="Saturation" value={editDraft.saturation} min={0} max={2} step={0.05} onChange={(value) => setEditDraft((current) => ({ ...current, saturation: value }))}/><LibraryEditRange label="Grayscale" value={editDraft.grayscale} min={0} max={1} step={0.05} onChange={(value) => setEditDraft((current) => ({ ...current, grayscale: value }))}/><LibraryAdvancedAdjustments draft={editDraft} onChange={setEditDraft}/>{isImage ? <div className="mt-4"><p className="m-0 text-[10px] font-medium capitalize text-[var(--misty-text-subtle)]">Crop &amp; Straighten</p><LibraryEditRange label="Straighten" value={editDraft.straighten} min={-45} max={45} step={0.5} onChange={(value) => setEditDraft((current) => ({ ...current, straighten: value }))}/><div className="mt-2 flex gap-1"><button className={smallButtonClass} type="button" onClick={() => setEditDraft((current) => ({ ...current, crop: undefined }))}>Original</button><button className={smallButtonClass} type="button" onClick={() => setEditDraft((current) => ({ ...current, crop: { x: 0.125, y: 0, width: 0.75, height: 1 } }))}>Square</button><button className={smallButtonClass} type="button" onClick={() => setEditDraft((current) => ({ ...current, crop: { x: 0, y: 0.125, width: 1, height: 0.75 } }))}>Wide</button></div></div> : null}{isVideo ? <div className="mt-4 grid grid-cols-2 gap-2"><label className="grid gap-1 text-[10px] capitalize text-[var(--misty-text-subtle)]">Trim Start<input className={inputClass} type="number" min={0} step={0.1} value={editDraft.trim?.start ?? 0} onChange={(event) => setEditDraft((current) => ({ ...current, trim: { start: Number(event.target.value), end: current.trim?.end ?? Math.max(1, Number(metadata.duration ?? 1)) } }))}/></label><label className="grid gap-1 text-[10px] capitalize text-[var(--misty-text-subtle)]">Trim End<input className={inputClass} type="number" min={0.1} step={0.1} value={editDraft.trim?.end ?? Number(metadata.duration ?? 1)} onChange={(event) => setEditDraft((current) => ({ ...current, trim: { start: current.trim?.start ?? 0, end: Number(event.target.value) } }))}/></label><label className="grid gap-1 text-[10px] capitalize text-[var(--misty-text-subtle)]">Speed<select className={inputClass} value={editDraft.playback_speed} onChange={(event) => setEditDraft((current) => ({ ...current, playback_speed: Number(event.target.value) }))}><option value={0.5}>0.5×</option><option value={1}>1×</option><option value={1.5}>1.5×</option><option value={2}>2×</option></select></label><button className={`${smallButtonClass} self-end`} type="button" onClick={() => setEditDraft((current) => ({ ...current, mute: !current.mute }))}>{editDraft.mute ? "Muted" : "Mute"}</button></div> : null}{editError ? <p className="mb-0 mt-3 text-xs text-red-200">{editError}</p> : null}<div className="mt-4 flex gap-2"><button className={`${secondaryButtonClass} flex-1 justify-center`} type="button" disabled={editSaving} onClick={() => { setEditing(false); setEditDraft(normalizeLibraryEdit(activeEdit?.edit_definition)); }}>Cancel</button><button className={`${primaryButtonClass} flex-1 justify-center`} type="button" disabled={editSaving} onClick={() => void saveEdit()}>{editSaving ? "Saving…" : "Save edit"}</button></div></section> : null}
          {canEdit ? <form onSubmit={(event) => void saveMetadata(event)}>
            <label className="grid gap-1.5 text-[10px] font-medium capitalize text-[var(--misty-text-subtle)]">Name<input className={inputClass} value={displayName} maxLength={255} onChange={(event) => setDisplayName(event.target.value)}/></label>
            <label className="mt-4 grid gap-1.5 text-[10px] font-medium capitalize text-[var(--misty-text-subtle)]">Caption<textarea className={`${inputClass} min-h-24 resize-y py-2`} value={caption} maxLength={4000} onChange={(event) => setCaption(event.target.value)}/></label>
            <label className="mt-4 grid gap-1.5 text-[10px] font-medium capitalize text-[var(--misty-text-subtle)]">Tags<input className={inputClass} value={tags} placeholder="project, receipt, reference" onChange={(event) => setTags(event.target.value)}/></label>
            <button className={`${primaryButtonClass} mt-4 w-full justify-center`} type="submit" disabled={saving || !displayName.trim()}>{saving ? "Saving…" : "Save metadata"}</button>
          </form> : <dl className="m-0 grid gap-3 text-xs"><LibraryMetadataRow label="Name" value={item.display_name}/><LibraryMetadataRow label="Caption" value={item.caption}/><LibraryMetadataRow label="Tags" value={item.tags.join(", ")}/></dl>}
          <dl className="mt-6 grid gap-3 border-t border-[var(--misty-border-soft)] pt-5 text-xs">
            <LibraryMetadataRow label="Type" value={mimeType}/>
            <LibraryMetadataRow label="Size" value={formatBytes(Number(metadata.byte_size ?? 0))}/>
            <LibraryMetadataRow label="Added" value={formatTime(item.added_at)}/>
            <LibraryMetadataRow label="Uploaded" value={formatTime(item.file.original_uploaded_at)}/>
            {metadata.capture_timestamp ? <LibraryMetadataRow label="Captured" value={formatTime(String(metadata.capture_timestamp))}/> : null}
            {metadata.width && metadata.height ? <LibraryMetadataRow label="Dimensions" value={`${metadata.width} × ${metadata.height}`}/> : null}
            {metadata.duration ? <LibraryMetadataRow label="Duration" value={`${Number(metadata.duration).toFixed(2)} s`}/> : null}
            {Array.isArray(metadata.codecs) ? <LibraryMetadataRow label="Codecs" value={metadata.codecs.join(", ")}/> : null}
            {metadata.frame_rate ? <LibraryMetadataRow label="Frame rate" value={`${Number(metadata.frame_rate).toFixed(2)} fps`}/> : null}
            <LibraryMetadataRow label="Original name" value={item.file.original_filename}/>
            {item.date_override ? <LibraryMetadataRow label="Adjusted date" value={formatTime(item.date_override)}/> : null}
            {item.location_override && Object.keys(item.location_override).length > 0 ? <LibraryMetadataRow label="Location" value={JSON.stringify(item.location_override)}/> : null}
          </dl>
          {editingAvailable ? <section className="mt-6 border-t border-[var(--misty-border-soft)] pt-5">
            <div className="flex items-center justify-between"><h3 className="m-0 text-sm">Versions</h3>{canEdit ? <button className={`${smallButtonClass} ${!activeEdit ? "text-[var(--misty-text)]" : ""}`} type="button" disabled={editSaving || !activeEdit} onClick={() => void selectEdit()}>Original</button> : !activeEdit ? <span className="text-[10px] text-[var(--misty-text-subtle)]">Original selected</span> : null}</div>
            {editError && !editing ? <p className="mb-0 mt-3 text-xs text-red-200">{editError}</p> : null}
            <div className="mt-3 grid gap-2">{editVersions.map((version) => <div className={`flex items-center gap-2 rounded-lg border px-2 py-2 ${version.is_current ? "border-[var(--misty-primary)]" : "border-[var(--misty-border-soft)]"}`} key={version.id}>
              <button className="min-w-0 flex-1 border-0 bg-transparent p-0 text-left" type="button" disabled={!canEdit || editSaving || version.is_current} onClick={() => void selectEdit(version.id)}><span className="block text-xs font-medium">Edit {version.version_number}{version.is_current ? " · Current" : ""}</span><span className="mt-0.5 block text-[10px] text-[var(--misty-text-subtle)]">{libraryRenditionStatus(version)} · {formatTime(version.created_at)}</span></button>
              {canEdit && (version.rendition_state === "none" || version.rendition_state === "failed") ? <button className={smallButtonClass} type="button" disabled={editSaving} onClick={() => void renderEdit(version.id)}>Render</button> : null}
              {canEdit && !version.is_current ? <button className="grid size-6 place-items-center border-0 bg-transparent text-[var(--misty-text-subtle)]" type="button" disabled={editSaving} onClick={() => void deleteEdit(version.id)} aria-label={`Delete edit ${version.version_number}`}><Trash2 size={12}/></button> : null}
            </div>)}</div>
          </section> : null}
        </aside>
      </section>
    </div>
  );
}

function LibraryMetadataRow({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-[10px] capitalize text-[var(--misty-text-subtle)]">{label}</dt><dd className="m-0 mt-1 break-words text-[var(--misty-text-muted)]">{value || "—"}</dd></div>;
}
function LibraryEditRange({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void }) {
  return <label className="mt-4 grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 text-[10px] font-medium capitalize text-[var(--misty-text-subtle)]"><span>{label}</span><span>{value.toFixed(2)}</span><input className="col-span-2 w-full accent-[var(--misty-primary)]" type="range" value={value} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))}/></label>;
}

function LibraryAdvancedAdjustments({ draft, onChange }: { draft: LibraryEditDefinition; onChange: Dispatch<SetStateAction<LibraryEditDefinition>> }) {
  const update = (key: keyof LibraryEditDefinition, value: number) => onChange((current) => ({ ...current, [key]: value }));
  return <details className="mt-4 rounded-xl border border-[var(--misty-border-soft)] px-3 py-2">
    <summary className="cursor-pointer text-[10px] font-medium capitalize text-[var(--misty-text-subtle)]">Advanced Adjustments</summary>
    <LibraryEditRange label="Exposure" value={draft.exposure} min={-2} max={2} step={0.05} onChange={(value) => update("exposure", value)}/>
    <LibraryEditRange label="Brilliance" value={draft.brilliance} min={-1} max={1} step={0.05} onChange={(value) => update("brilliance", value)}/>
    <LibraryEditRange label="Highlights" value={draft.highlights} min={-1} max={1} step={0.05} onChange={(value) => update("highlights", value)}/>
    <LibraryEditRange label="Shadows" value={draft.shadows} min={-1} max={1} step={0.05} onChange={(value) => update("shadows", value)}/>
    <LibraryEditRange label="Black Point" value={draft.black_point} min={-1} max={1} step={0.05} onChange={(value) => update("black_point", value)}/>
    <LibraryEditRange label="Vibrance" value={draft.vibrance} min={-1} max={1} step={0.05} onChange={(value) => update("vibrance", value)}/>
    <LibraryEditRange label="Warmth" value={draft.warmth} min={-1} max={1} step={0.05} onChange={(value) => update("warmth", value)}/>
    <LibraryEditRange label="Tint" value={draft.tint} min={-1} max={1} step={0.05} onChange={(value) => update("tint", value)}/>
    <LibraryEditRange label="Sharpness" value={draft.sharpness} min={0} max={2} step={0.05} onChange={(value) => update("sharpness", value)}/>
    <LibraryEditRange label="Definition" value={draft.definition} min={0} max={2} step={0.05} onChange={(value) => update("definition", value)}/>
    <LibraryEditRange label="Noise Reduction" value={draft.noise_reduction} min={0} max={1} step={0.05} onChange={(value) => update("noise_reduction", value)}/>
    <LibraryEditRange label="Vignette" value={draft.vignette} min={0} max={1} step={0.05} onChange={(value) => update("vignette", value)}/>
  </details>;
}

function defaultLibraryEdit(): LibraryEditDefinition {
  return { rotation: 0, flip_horizontal: false, flip_vertical: false, auto_enhance: false, filter: "", brightness: 1, contrast: 1, saturation: 1, grayscale: 0, exposure: 0, brilliance: 0, highlights: 0, shadows: 0, black_point: 0, vibrance: 0, warmth: 0, tint: 0, sharpness: 0, definition: 0, noise_reduction: 0, vignette: 0, straighten: 0, markup: [], mute: false, playback_speed: 1 };
}

function normalizeLibraryEdit(definition?: Partial<LibraryEditDefinition> | null): LibraryEditDefinition {
  return { ...defaultLibraryEdit(), ...definition, markup: definition?.markup ?? [] };
}

function libraryEditStyle(definition: LibraryEditDefinition) {
  const crop = definition.crop;
  const preset = definition.filter === "vivid" ? "contrast(1.08) saturate(1.28)" : definition.filter === "dramatic" ? "contrast(1.25) saturate(.82) brightness(.92)" : definition.filter === "warm" ? "sepia(.12) saturate(1.08)" : definition.filter === "cool" ? "hue-rotate(8deg) saturate(1.05)" : definition.filter === "mono" ? "grayscale(1)" : definition.filter === "noir" ? "grayscale(1) contrast(1.35) brightness(.96)" : "";
  const enhance = definition.auto_enhance ? "contrast(1.05) saturate(1.08) brightness(1.02)" : "";
  return {
    filter: `brightness(${definition.brightness + definition.exposure * .125 + definition.brilliance * .05 - definition.black_point * .04}) contrast(${definition.contrast * (1 + definition.highlights * .18 - definition.shadows * .08 + definition.black_point * .16)}) saturate(${definition.saturation * (1 + definition.vibrance * .5)}) grayscale(${definition.grayscale}) sepia(${Math.max(0, definition.warmth) * .08}) hue-rotate(${definition.tint * 8 - definition.warmth * 4}deg) blur(${definition.noise_reduction * .35}px) drop-shadow(0 0 ${definition.vignette * 16}px rgba(0,0,0,${definition.vignette * .6})) ${enhance} ${preset}`,
    transform: `rotate(${definition.rotation + definition.straighten}deg) scaleX(${definition.flip_horizontal ? -1 : 1}) scaleY(${definition.flip_vertical ? -1 : 1})`,
    clipPath: crop ? `inset(${crop.y * 100}% ${(1 - crop.x - crop.width) * 100}% ${(1 - crop.y - crop.height) * 100}% ${crop.x * 100}%)` : undefined,
  };
}

async function createLongExposureImage(source: Blob): Promise<Blob> {
  const sourceURL = URL.createObjectURL(source);
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "auto";
  video.src = sourceURL;
  try {
    await waitForMediaEvent(video, "loadeddata");
    if (!Number.isFinite(video.duration) || video.duration <= 0 || video.videoWidth < 1 || video.videoHeight < 1) throw new Error("Motion media is unavailable.");
    const scale = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Long Exposure rendering is unavailable.");
    const frameCount = 12;
    const sums = new Uint32Array(canvas.width * canvas.height * 4);
    for (let frame = 0; frame < frameCount; frame += 1) {
      if (frame > 0) {
        video.currentTime = Math.min(video.duration - .001, video.duration * frame / (frameCount - 1));
        await waitForMediaEvent(video, "seeked");
      }
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let index = 0; index < pixels.length; index += 1) sums[index] += pixels[index];
    }
    const output = context.createImageData(canvas.width, canvas.height);
    for (let index = 0; index < output.data.length; index += 1) output.data[index] = Math.round(sums[index] / frameCount);
    context.putImageData(output, 0, 0);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Long Exposure rendering failed.")), "image/jpeg", .92));
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(sourceURL);
  }
}

function waitForMediaEvent(media: HTMLMediaElement, eventName: "loadeddata" | "seeked"): Promise<void> {
  if (eventName === "loadeddata" && media.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const done = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error("Motion media could not be decoded.")); };
    const cleanup = () => {
      media.removeEventListener(eventName, done);
      media.removeEventListener("error", failed);
    };
    media.addEventListener(eventName, done, { once: true });
    media.addEventListener("error", failed, { once: true });
  });
}

function libraryRenditionStatus(version: LibraryEditVersion): string {
  switch (version.rendition_state) {
    case "queued": return "Queued";
    case "processing": return "Rendering";
    case "ready": return version.rendition_byte_size ? `Ready · ${formatBytes(version.rendition_byte_size)}` : "Ready";
    case "failed": return "Render failed";
    default: return "Not rendered";
  }
}

function LibraryItemThumbnail({ spaceId, item, reauthenticationToken = "" }: { spaceId: string; item: SpaceLibraryItem; reauthenticationToken?: string }) {
  const [preview, setPreview] = useState<{ url: string; kind: "image" | "pdf" } | null>(null);
  const mimeType = libraryItemMIME(item);
  const visual = libraryItemThumbnailEligible(mimeType, item.file.original_filename) || Number(item.file.intrinsic_metadata.width ?? 0) > 0;
  useEffect(() => {
    if (!visual) {
      setPreview(null);
      return;
    }
    let current = true;
    let objectUrl = "";
    const request = spacesApi.libraryPreview(spaceId, item.id, reauthenticationToken, item.version).catch(() => mimeType.startsWith("image/") || mimeType === "application/pdf" ? spacesApi.libraryContent(spaceId, item.id, reauthenticationToken) : Promise.reject(new Error("The file reader could not load this item")));
    void request.then((blob) => {
      if (!current) return;
      objectUrl = URL.createObjectURL(blob);
      setPreview({ url: objectUrl, kind: blob.type === "application/pdf" || mimeType === "application/pdf" && !blob.type.startsWith("image/") ? "pdf" : "image" });
    }).catch(() => setPreview(null));
    return () => {
      current = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [item.id, item.version, mimeType, reauthenticationToken, spaceId, visual]);
  return preview?.kind === "image" ? <img className="size-full object-cover" src={preview.url} alt=""/> : preview?.kind === "pdf" ? <object className="pointer-events-none size-full bg-white" data={preview.url} type="application/pdf" aria-label={`PDF thumbnail for ${item.display_name}`}/> : <File size={30}/>;
}

type LibraryAssetStackInput = Pick<LibraryAssetStack, "kind" | "title" | "cover_item_id" | "motion_item_id" | "members">;

function buildLibraryAssetStack(kind: LibraryAssetStack["kind"], items: SpaceLibraryItem[]): LibraryAssetStackInput | null {
  if (kind === "live_photo") {
    if (items.length !== 2) return null;
    const still = items.find((item) => libraryItemMIME(item).startsWith("image/"));
    const motion = items.find((item) => libraryItemMIME(item).startsWith("video/"));
    if (!still || !motion) return null;
    return { kind, title: "", cover_item_id: still.id, motion_item_id: motion.id, members: [{ item_id: still.id, role: "still", position: 0 }, { item_id: motion.id, role: "motion", position: 1 }] };
  }
  if (kind === "raw_pair") {
    if (items.length !== 2) return null;
    const raw = items.find((item) => isLibraryRAW(item.file.original_filename));
    const rendered = items.find((item) => item.id !== raw?.id && libraryItemMIME(item).startsWith("image/"));
    if (!raw || !rendered) return null;
    return { kind, title: "", cover_item_id: rendered.id, members: [{ item_id: rendered.id, role: "alternate", position: 0 }, { item_id: raw.id, role: "raw", position: 1 }] };
  }
  if (items.length < 2 || items.length > 100 || items.some((item) => !libraryItemMIME(item).startsWith("image/"))) return null;
  return { kind, title: "", cover_item_id: items[0].id, members: items.map((item, position) => ({ item_id: item.id, role: "burst_frame" as const, position })) };
}

function detectUploadedAssetStacks(items: SpaceLibraryItem[]): LibraryAssetStackInput[] {
  const result: LibraryAssetStackInput[] = [];
  const byStem = new Map<string, SpaceLibraryItem[]>();
  const bursts = new Map<string, SpaceLibraryItem[]>();
  for (const item of items) {
    const filename = item.file.original_filename;
    const stem = filename.replace(/\.[^.]+$/, "").toLocaleLowerCase();
    byStem.set(stem, [...(byStem.get(stem) ?? []), item]);
    const burstMatch = filename.replace(/\.[^.]+$/, "").match(/^(.*?)[_-]burst[_-]?(?:\d+)(?:[_-](?:cover|key))?$/i);
    if (burstMatch) {
      const key = burstMatch[1].toLocaleLowerCase();
      bursts.set(key, [...(bursts.get(key) ?? []), item]);
    }
  }
  for (const grouped of byStem.values()) {
    const live = buildLibraryAssetStack("live_photo", grouped);
    if (live) result.push(live);
    const rawPair = buildLibraryAssetStack("raw_pair", grouped);
    if (rawPair) result.push(rawPair);
  }
  for (const grouped of bursts.values()) {
    const burst = buildLibraryAssetStack("burst", grouped);
    if (burst) result.push(burst);
  }
  return result;
}

function libraryItemMIME(item: SpaceLibraryItem): string {
  const metadataMIME = String(item.file.intrinsic_metadata.server_detected_mime_type ?? item.file.intrinsic_metadata.client_declared_mime_type ?? "").split(";")[0].toLocaleLowerCase();
  if (metadataMIME && metadataMIME !== "application/octet-stream") return metadataMIME;
  const extension = item.file.original_filename.split(".").pop()?.toLocaleLowerCase() ?? "";
  if (["bmp", "gif", "heic", "heif", "jpeg", "jpg", "png", "tif", "tiff", "webp"].includes(extension)) return `image/${extension === "jpg" ? "jpeg" : extension === "tif" ? "tiff" : extension}`;
  if (["avi", "m4v", "mkv", "mov", "mp4", "mpeg", "mpg", "webm"].includes(extension)) return `video/${extension === "mov" ? "quicktime" : extension === "m4v" ? "mp4" : extension}`;
  if (["aac", "aif", "aiff", "flac", "m4a", "mp3", "ogg", "opus", "wav"].includes(extension)) return `audio/${extension === "mp3" ? "mpeg" : extension}`;
  return "application/octet-stream";
}

function libraryFileTypeLabel(item: SpaceLibraryItem): string {
  const mime = libraryItemMIME(item);
  if (mime === "application/pdf") return "PDF";
  if (mime.startsWith("image/")) return mime.slice(6).replace("jpeg", "JPEG").replace("png", "PNG").replace("webp", "WebP").toUpperCase();
  if (mime.startsWith("video/")) return mime.slice(6).replace("quicktime", "MOV").toUpperCase();
  if (mime.startsWith("audio/")) return mime.slice(6).replace("mpeg", "MP3").toUpperCase();
  const extension = item.file.original_filename.split(".").pop()?.trim();
  return extension ? extension.toUpperCase() : "File";
}

function activeSensitiveGrant(grant?: { token: string; expiresAt: string }): string {
  return grant && new Date(grant.expiresAt).getTime() > Date.now() ? grant.token : "";
}

function isLibraryRAW(filename: string): boolean {
  return /\.(?:dng|cr2|cr3|nef|nrw|arw|srf|sr2|raf|rw2|orf|pef|x3f)$/i.test(filename);
}

function AlbumCover({ spaceId, itemId }: { spaceId: string; itemId?: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let current = true;
    let objectUrl = "";
    setUrl("");
    if (!itemId) return () => { current = false; };
    void spacesApi.libraryPreview(spaceId, itemId).then((blob) => {
      if (!current) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => setUrl(""));
    return () => {
      current = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [itemId, spaceId]);
  return <span className="grid aspect-[4/3] w-full place-items-center overflow-hidden bg-[var(--misty-surface-2)] text-[var(--misty-text-subtle)]">{url ? <img className="size-full object-cover" src={url} alt=""/> : <LibraryIcon size={26}/>}</span>;
}

function LibraryFacetGroup({ label, facets, onSelect }: { label: string; facets: LibrarySearchFacets["tags"]; onSelect: (facet: LibrarySearchFacets["tags"][number]) => void }) {
  return <div className="flex min-w-0 items-center gap-1.5"><span className="mr-0.5 text-[10px] font-semibold capitalize text-[var(--misty-text-subtle)]">{label}</span>{facets.slice(0, 6).map((facet) => <button className={smallButtonClass} type="button" key={`${facet.value}:${facet.label}`} onClick={() => onSelect(facet)}>{facet.label}<span className="text-[var(--misty-text-subtle)]">{facet.count}</span></button>)}</div>;
}

function libraryUtilityIcon(value: string): LucideIcon {
  if (value === "featured") return Sparkles;
  if (value === "recently-edited") return SlidersHorizontal;
  if (value === "recently-shared") return MessagesSquare;
  if (value === "screenshots") return ImageIcon;
  if (value === "handwriting") return Pencil;
  if (value === "illustrations") return Sparkles;
  if (value === "documents" || value === "receipts" || value === "qr-codes") return File;
  return History;
}

function LibraryCollectionCard({ icon: Icon, label, count, disabled = false, pinned = false, onClick, onTogglePin, onMoveEarlier, onMoveLater }: { icon: LucideIcon; label: string; count: number; disabled?: boolean; pinned?: boolean; onClick?: () => void; onTogglePin?: () => void; onMoveEarlier?: () => void; onMoveLater?: () => void }) {
  const canEdit = useContext(LibraryCanEditContext);
  return <article className="group relative overflow-hidden rounded-2xl border border-[var(--misty-border-soft)] bg-[var(--misty-app-panel-bg,var(--misty-app-page-bg,var(--misty-bg)))]"><button className="block w-full border-0 bg-transparent p-4 text-left disabled:opacity-40" type="button" disabled={disabled} onClick={onClick}><Icon size={22}/><p className="mb-0 mt-3 truncate text-xs font-medium">{label}</p><p className="mb-0 mt-1 text-[10px] text-[var(--misty-text-subtle)]">{count} items</p></button>{canEdit && onTogglePin && !disabled ? <button className={`absolute right-2 top-2 grid size-7 place-items-center rounded-lg border-0 ${pinned ? "bg-[var(--misty-surface-3)] text-[var(--misty-text)]" : "bg-transparent text-[var(--misty-text-subtle)] opacity-0 group-hover:opacity-100 focus:opacity-100"}`} type="button" onClick={onTogglePin} title={pinned ? "Unpin" : "Pin collection"} aria-label={`${pinned ? "Unpin" : "Pin"} ${label}`}><Pin size={13} fill={pinned ? "currentColor" : "none"}/></button> : null}{canEdit && (onMoveEarlier || onMoveLater) ? <span className="absolute bottom-2 right-2 flex gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100">{onMoveEarlier ? <button className="grid size-6 place-items-center rounded-md border-0 bg-[var(--misty-surface-2)] text-[var(--misty-text-muted)]" type="button" onClick={onMoveEarlier} title="Move earlier" aria-label={`Move ${label} earlier`}><ChevronLeft size={12}/></button> : null}{onMoveLater ? <button className="grid size-6 place-items-center rounded-md border-0 bg-[var(--misty-surface-2)] text-[var(--misty-text-muted)]" type="button" onClick={onMoveLater} title="Move later" aria-label={`Move ${label} later`}><ChevronRight size={12}/></button> : null}</span> : null}</article>;
}

function LibraryMapView({ points, onBack, onSelect }: { points: LibraryMapPoint[]; onBack: () => void; onSelect: (point: LibraryMapPoint) => void }) {
  return <div className="mb-6">
    <button className="mb-4 border-0 bg-transparent p-0 text-xs text-[var(--misty-text-muted)]" type="button" onClick={onBack}>← Collections</button>
    <div className="overflow-hidden rounded-2xl border border-[var(--misty-border-soft)] bg-[linear-gradient(145deg,#10222c,#111922_60%,#18232d)] p-3">
      <svg className="block aspect-[2/1] w-full" viewBox="0 0 1000 500" role="img" aria-label={`Map showing ${points.length} saved locations`}>
        <defs><radialGradient id="misty-map-point" cx="35%" cy="30%"><stop offset="0" stopColor="#fff"/><stop offset="0.25" stopColor="#b7d8ff"/><stop offset="1" stopColor="#5b78ff"/></radialGradient></defs>
        {[125, 250, 375].map((y) => <line key={`latitude-${y}`} x1="0" x2="1000" y1={y} y2={y} stroke="rgba(255,255,255,.08)" strokeWidth="1"/>)}
        {[125, 250, 375, 500, 625, 750, 875].map((x) => <line key={`longitude-${x}`} x1={x} x2={x} y1="0" y2="500" stroke="rgba(255,255,255,.08)" strokeWidth="1"/>)}
        <path d="M65 110L145 68 236 83 276 136 247 180 194 188 167 239 112 225 89 173Z M253 251L313 267 340 333 319 423 272 452 238 376Z M430 93L506 65 568 92 552 128 594 151 573 201 516 194 488 238 448 221 421 165Z M558 236L620 249 660 316 630 410 574 430 537 352Z M590 83L697 62 814 93 877 135 853 183 779 172 740 216 681 199 637 153Z M807 327L875 302 932 336 916 394 848 408 805 371Z" fill="rgba(129,167,151,.22)" stroke="rgba(190,220,205,.25)" strokeWidth="2"/>
        {points.map((point) => {
          const x = (point.longitude + 180) / 360 * 1000;
          const y = (90 - point.latitude) / 180 * 500;
          const radius = Math.min(18, 7 + Math.log2(point.item_count + 1) * 2);
          return <g className="cursor-pointer outline-none" role="button" tabIndex={0} aria-label={`${point.name}, ${point.item_count} items`} key={point.id} transform={`translate(${x} ${y})`} onClick={() => onSelect(point)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onSelect(point); }}>
            <circle r={radius + 5} fill="rgba(83,120,255,.18)"/><circle r={radius} fill="url(#misty-map-point)" stroke="rgba(255,255,255,.8)" strokeWidth="2"/><text x="0" y="4" textAnchor="middle" fill="#08101a" fontSize="10" fontWeight="700">{point.item_count}</text><title>{point.name}</title>
          </g>;
        })}
      </svg>
    </div>
    <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">{points.slice(0, 12).map((point) => <button className="rounded-xl border border-[var(--misty-border-soft)] bg-[var(--misty-app-panel-bg,var(--misty-app-page-bg,var(--misty-bg)))] p-3 text-left" type="button" key={point.id} onClick={() => onSelect(point)}><p className="m-0 truncate text-xs font-medium">{point.name}</p><p className="mb-0 mt-1 text-[10px] text-[var(--misty-text-subtle)]">{point.item_count} items · {point.latitude.toFixed(2)}, {point.longitude.toFixed(2)}</p></button>)}</div>
  </div>;
}

function LibraryDiscoveryCard({ spaceId, group, fallbackIcon: Icon, pinned = false, onTogglePin, onClick }: { spaceId: string; group: LibraryDiscoveryGroup; fallbackIcon: LucideIcon; pinned?: boolean; onTogglePin?: () => void; onClick: () => void }) {
  const canEdit = useContext(LibraryCanEditContext);
  return <article className="group relative overflow-hidden rounded-2xl border border-[var(--misty-border-soft)] bg-[var(--misty-app-panel-bg,var(--misty-app-page-bg,var(--misty-bg)))]"><button className="block w-full border-0 bg-transparent p-0 text-left" type="button" onClick={onClick}><span className="relative block"><AlbumCover spaceId={spaceId} itemId={group.cover_item_id}/><span className="absolute left-3 top-3 grid size-8 place-items-center rounded-xl bg-black/55 text-white backdrop-blur"><Icon size={16}/></span></span><span className="block p-3"><span className="block truncate text-xs font-medium">{group.title}</span><span className="mt-1 block truncate text-[10px] text-[var(--misty-text-subtle)]">{group.subtitle}</span></span></button>{canEdit && onTogglePin ? <button className={`absolute right-3 top-3 grid size-8 place-items-center rounded-xl border-0 backdrop-blur ${pinned ? "bg-white text-black" : "bg-black/55 text-white opacity-0 group-hover:opacity-100 focus:opacity-100"}`} type="button" onClick={onTogglePin} title={pinned ? "Unpin" : "Pin collection"} aria-label={`${pinned ? "Unpin" : "Pin"} ${group.title}`}><Pin size={14} fill={pinned ? "currentColor" : "none"}/></button> : null}</article>;
}

const iconButtonClass = "grid size-8 place-items-center rounded-xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] p-0 text-[var(--misty-text)]";
const smallButtonClass = "inline-flex items-center gap-1 rounded-lg border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] px-2 py-1 text-[10px] text-[var(--misty-text-muted)]";
const messageActionButtonClass = "grid size-7 place-items-center rounded-lg border-0 bg-transparent text-[var(--misty-text-subtle)] opacity-60 transition-opacity hover:bg-[var(--misty-surface-2)] hover:opacity-100 focus:opacity-100";
const secondaryButtonClass = "inline-flex min-h-9 items-center gap-2 rounded-xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] px-3 text-xs text-[var(--misty-text)]";
const primaryButtonClass = "inline-flex min-h-9 items-center gap-2 rounded-xl border-0 bg-[var(--misty-primary)] px-3 text-xs text-[var(--misty-primary-contrast)]";
const rowActionClass = "invisible grid size-7 place-items-center rounded-lg border-0 bg-transparent text-[var(--misty-text-subtle)] hover:bg-[var(--misty-surface-2)] group-hover:visible";
const inputClass = "min-h-10 rounded-xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] px-3 text-sm text-[var(--misty-text)] outline-none focus:border-[var(--misty-primary)]";
const libraryControlClass = "h-8 shrink-0 rounded-lg border border-[var(--misty-border-soft)] bg-[var(--misty-app-surface-bg,var(--misty-surface))] px-2 text-xs text-[var(--misty-text-muted)] outline-none";

const emptyMessages: SpaceMessage[] = [], emptyMembers: SpaceMember[] = [], emptyNodes: SpaceNode[] = [], emptyStudioResources: SpaceStudioResource[] = [];
