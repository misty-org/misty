import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Navigate, NavLink, Outlet, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Check,
  Copy,
  ChevronLeft,
  ChevronRight,
  Download,
  EyeOff,
  File,
  Folder,
  Grid3X3,
  History,
  Image as ImageIcon,
  BookOpenText as LibraryIcon,
  Music2,
  Map as MapIcon,
  MapPin,
  List,
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
  UserPlus,
  Users,
  Video,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useAuth } from "../../auth/AuthContext";
import { useSpacesStore } from "../../stores/useSpacesStore";
import { useSetupStore } from "../../stores/useSetupStore";
import { spacesApi } from "../../spaces/api";
import type { BulkLibraryItemAction, BulkLibraryItemOptions, LibraryAlbum, LibraryAlbumFolder, LibraryDiscovery, LibraryDiscoveryGroup, LibraryEditDefinition, LibraryEditVersion, LibraryGroup, LibraryImportHistoryItem, LibraryIntelligencePolicy, LibraryItemQuery, LibraryMapPoint, LibraryPerson, LibraryPinnedCollection, LibrarySearchFacets, LibrarySharedReference, MessageAttachment, MessageSpan, SpaceLibraryItem, SpaceMember, SpaceMessage, SpaceNode, SpaceStorageUsage, SpaceStudioResource } from "../../spaces/types";

const spaceSectionItems = [
  { id: "chat", label: "Chat", icon: MessagesSquare },
  { id: "library", label: "Library", icon: LibraryIcon },
  { id: "members", label: "Members", icon: Users },
] as const;

type LibraryCollectionKind = "recent" | "months" | "years" | "recent-days" | "utility" | "collections" | "favorites" | "hidden" | "deleted" | "people" | "albums" | "groups" | "memory" | "trip" | "map" | "duplicate" | "shared" | "imports";

export default function SpacesShell() {
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [creating, setCreating] = useState(false);
  const [renamingSpaceId, setRenamingSpaceId] = useState("");
  const [renameName, setRenameName] = useState("");
  const [renameSaving, setRenameSaving] = useState(false);
  const { spaces, invitations, limits, loading, error, load, createSpace, renameSpace, respondInvite, clearError } = useSpacesStore(useShallow((state) => ({
    spaces: state.spaces,
    invitations: state.invitations,
    limits: state.limits,
    loading: state.loading,
    error: state.error,
    load: state.load,
    createSpace: state.createSpace,
    renameSpace: state.renameSpace,
    respondInvite: state.respondInvite,
    clearError: state.clearError,
  })));

  useEffect(() => { void load(); }, [load]);

  const onCreate = async (event: FormEvent) => {
    event.preventDefault();
    const name = createName.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      const created = await createSpace(name);
      setCreateName("");
      setCreateOpen(false);
      navigate(`/spaces/${encodeURIComponent(created.id)}/library`);
    } catch { /* the dialog renders the store error */ }
    finally { setCreating(false); }
  };

  const saveSpaceName = async (event: FormEvent) => {
    event.preventDefault();
    const name = renameName.trim();
    const space = spaces.find((item) => item.id === renamingSpaceId);
    if (!space || !name || name === space.name || renameSaving) return;
    setRenameSaving(true);
    try {
      await renameSpace(space.id, name);
      setRenamingSpaceId("");
    } catch { /* the sidebar renders the store error */ }
    finally { setRenameSaving(false); }
  };

  return (
    <div className="grid h-full min-h-0 grid-cols-[220px_minmax(0,1fr)] bg-[var(--misty-app-page-bg,#07090b)]">
      <aside className="min-h-0 overflow-auto border-r border-[var(--misty-border-soft)] bg-[var(--misty-surface)] px-3 py-4">
        <div className="mb-4 flex items-center justify-between px-2">
          <div>
            <h1 className="m-0 text-lg font-semibold text-[var(--misty-text)]">Spaces</h1>
            <p className="m-0 mt-0.5 text-[11px] text-[var(--misty-text-subtle)]">Private until you invite someone</p>
          </div>
          <button className={iconButtonClass} type="button" disabled={(limits?.remaining_owned ?? 1) === 0} onClick={() => { clearError(); setCreateOpen(true); }} aria-label="Create Space" title={(limits?.remaining_owned ?? 1) === 0 ? "You already own three Spaces" : "Create Space"}>
            <Plus size={16} />
          </button>
        </div>
        {error && !createOpen && !renamingSpaceId ? <button className="mb-3 w-full rounded-xl border border-red-400/20 bg-red-950/20 px-3 py-2 text-left text-[11px] leading-relaxed text-red-200" type="button" onClick={clearError}>{error}</button> : null}
        <nav className="grid gap-1" aria-label="Spaces">
          {spaces.map((space) => (
            <div className="group relative" key={space.id}>
              <NavLink className={spaceLinkClass} to={`/spaces/${encodeURIComponent(space.id)}/${space.is_personal ? "library" : "chat"}`}>
                <span className="grid size-7 place-items-center rounded-lg bg-[var(--misty-surface-3)] text-[11px] font-bold">{space.name.slice(0, 2).toUpperCase()}</span>
                <span className="min-w-0 flex-1 truncate">{space.name}</span>
              </NavLink>
              {space.role === "owner" ? <button className="invisible absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-lg border-0 bg-[var(--misty-surface-3)] text-[var(--misty-text-muted)] hover:text-[var(--misty-text)] group-hover:visible focus:visible" type="button" onClick={() => { clearError(); setRenameName(space.name); setRenamingSpaceId(space.id); }} aria-label={`Rename ${space.name}`} title="Rename Space"><Pencil size={13}/></button> : null}
            </div>
          ))}
          {loading && spaces.length === 0 ? <p className="px-2 py-3 text-xs text-[var(--misty-text-subtle)]">Loading Spaces…</p> : null}
        </nav>
        {invitations.length > 0 ? (
          <section className="mt-5 border-t border-[var(--misty-border-soft)] pt-4">
            <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.13em] text-[var(--misty-text-subtle)]">Invitations</p>
            {invitations.map((invite) => (
              <article key={invite.id} className="mb-2 rounded-xl bg-[var(--misty-surface-2)] p-2.5 text-xs">
                <p className="m-0 truncate font-medium">{invite.space_name}</p>
                <div className="mt-2 flex gap-1.5">
                  <button className={smallButtonClass} type="button" onClick={() => void respondInvite(invite.id, true)}><Check size={13} />Accept</button>
                  <button className={smallButtonClass} type="button" onClick={() => void respondInvite(invite.id, false)}>Decline</button>
                </div>
              </article>
            ))}
          </section>
        ) : null}
      </aside>
      <main className="min-h-0 min-w-0"><Outlet /></main>
      {createOpen ? (
        <div className="fixed inset-0 z-[2147483000] grid place-items-center bg-black/60 p-6" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !creating) { clearError(); setCreateOpen(false); } }}>
          <form className="w-full max-w-sm rounded-2xl border border-[var(--misty-border-strong)] bg-[var(--misty-modal-bg,var(--misty-surface))] p-5 shadow-2xl" onSubmit={(event) => void onCreate(event)}>
            <div className="flex items-start justify-between gap-4">
              <div><h2 className="m-0 text-base font-semibold">Create a Space</h2><p className="mb-0 mt-1 text-xs leading-relaxed text-[var(--misty-text-subtle)]">It starts private. You can own three Spaces total, including Default space.</p></div>
              <button className={iconButtonClass} type="button" disabled={creating} onClick={() => { clearError(); setCreateOpen(false); }} aria-label="Close"><X size={15}/></button>
            </div>
            <label className="mt-5 grid gap-2 text-xs font-medium text-[var(--misty-text-muted)]">Space name<input className={inputClass} autoFocus maxLength={80} placeholder="Design team" value={createName} onChange={(event) => setCreateName(event.target.value)} /></label>
            <p className="mb-0 mt-3 text-[11px] text-[var(--misty-text-subtle)]">{limits ? `${limits.owned} of ${limits.owned_limit} ownership slots used · ${limits.remaining_owned} remaining` : "Checking ownership slots…"}</p>
            {error ? <p className="mb-0 mt-3 rounded-xl border border-red-400/20 bg-red-950/20 px-3 py-2 text-xs leading-relaxed text-red-200" role="alert">{error}</p> : null}
            <div className="mt-5 flex justify-end gap-2"><button className={secondaryButtonClass} type="button" disabled={creating} onClick={() => { clearError(); setCreateOpen(false); }}>Cancel</button><button className={primaryButtonClass} type="submit" disabled={creating || !createName.trim()}>{creating ? "Creating…" : "Create Space"}</button></div>
          </form>
        </div>
      ) : null}
      {renamingSpaceId ? (
        <div className="fixed inset-0 z-[2147483000] grid place-items-center bg-black/60 p-6" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !renameSaving) { clearError(); setRenamingSpaceId(""); } }}>
          <form className="w-full max-w-sm rounded-2xl border border-[var(--misty-border-strong)] bg-[var(--misty-modal-bg,var(--misty-surface))] p-5 shadow-2xl" onSubmit={(event) => void saveSpaceName(event)}>
            <div className="flex items-start justify-between gap-4">
              <h2 className="m-0 text-base font-semibold">Rename Space</h2>
              <button className={iconButtonClass} type="button" disabled={renameSaving} onClick={() => { clearError(); setRenamingSpaceId(""); }} aria-label="Close"><X size={15}/></button>
            </div>
            <label className="mt-5 grid gap-2 text-xs font-medium text-[var(--misty-text-muted)]">Space name<input className={inputClass} autoFocus maxLength={80} value={renameName} onChange={(event) => setRenameName(event.target.value)} /></label>
            {error ? <p className="mb-0 mt-3 rounded-xl border border-red-400/20 bg-red-950/20 px-3 py-2 text-xs leading-relaxed text-red-200" role="alert">{error}</p> : null}
            <div className="mt-5 flex justify-end gap-2"><button className={secondaryButtonClass} type="button" disabled={renameSaving} onClick={() => { clearError(); setRenamingSpaceId(""); }}>Cancel</button><button className={primaryButtonClass} type="submit" disabled={renameSaving || !renameName.trim() || renameName.trim() === spaces.find((item) => item.id === renamingSpaceId)?.name}>{renameSaving ? "Renaming…" : "Rename"}</button></div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

export function PersonalSpaceRedirect() {
  const { spaces, loading, load } = useSpacesStore(useShallow((state) => ({ spaces: state.spaces, loading: state.loading, load: state.load })));
  const personal = spaces.find((space) => space.is_personal);
  const attemptedLoad = useRef(false);

  useEffect(() => {
    if (!personal && !loading && !attemptedLoad.current) {
      attemptedLoad.current = true;
      void load();
    }
  }, [load, loading, personal]);

  if (personal) return <Navigate to={`/spaces/${encodeURIComponent(personal.id)}/library`} replace />;
  return <div className="grid h-full place-items-center text-sm text-[var(--misty-text-muted)]">Loading Default space…</div>;
}

function SpaceSectionNavigation({ spaceId, section }: { spaceId: string; section: string }) {
  const navigate = useNavigate();
  return (
    <nav className="flex shrink-0 rounded-xl bg-[var(--misty-surface-2)] p-1" aria-label="Space sections">
      {spaceSectionItems.map(({ id, label, icon: Icon }) => (
        <button key={id} className={`grid size-9 place-items-center rounded-lg border-0 ${section === id ? "bg-[var(--misty-surface-3)] text-[var(--misty-text)] shadow-sm" : "bg-transparent text-[var(--misty-text-muted)] hover:text-[var(--misty-text)]"}`} type="button" onClick={() => navigate(`/spaces/${encodeURIComponent(spaceId)}/${id}`)} aria-label={label} title={label} aria-current={section === id ? "page" : undefined}><Icon size={16}/></button>
      ))}
    </nav>
  );
}

export function SpaceDetail() {
  const { spaceId = "", section = "chat" } = useParams();
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
      {section === "library" || section === "files" ? <SpaceLibrary spaceId={spaceId} section={section} /> : (
        <div className="grid h-full min-h-0 grid-rows-[56px_minmax(0,1fr)]">
          <div className="flex items-center justify-end border-b border-[var(--misty-border-soft)] px-6"><SpaceSectionNavigation spaceId={spaceId} section={section}/></div>
          <div className="relative min-h-0">{section === "members" ? <SpaceMembers spaceId={spaceId} /> : <SpaceChat spaceId={spaceId} />}</div>
        </div>
      )}
    </div>
  );
}

function SpaceChat({ spaceId }: { spaceId: string }) {
  const { user: authUser } = useAuth();
  const setupUser = useSetupStore((state) => state.status?.current_user ?? null);
  const user = authUser ?? setupUser;
  const [searchParams] = useSearchParams();
  const endRef = useRef<HTMLDivElement | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const [text, setText] = useState("");
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [selectedLibraryIds, setSelectedLibraryIds] = useState<string[]>([]);
  const [pendingAttachments, setPendingAttachments] = useState<MessageAttachment[]>([]);
  const [libraryItems, setLibraryItems] = useState<SpaceLibraryItem[]>([]);
  const [libraryPickerOpen, setLibraryPickerOpen] = useState(false);
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  const [replyToMessageId, setReplyToMessageId] = useState("");
  const [editingMessageId, setEditingMessageId] = useState("");
  const [editingText, setEditingText] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const { messagesBySpace, membersBySpace, agentsBySpace, nodesBySpace, sending, sendMessage, updateMessage, deleteMessage, markRead, loadMessages, loadStudio, openNode } = useSpacesStore(useShallow((state) => ({
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
    loadStudio: state.loadStudio,
    openNode: state.openNode,
  })));
  const messages = messagesBySpace[spaceId] ?? emptyMessages;
  const members = membersBySpace[spaceId] ?? emptyMembers;
  const agents = agentsBySpace[spaceId] ?? emptyStudioResources;
  const allNodes = nodesBySpace[spaceId] ?? emptyNodes;
  const nodes = useMemo(() => allNodes.filter((node) => node.kind === "link"), [allNodes]);

  useEffect(() => {
    setText("");
    setSelectedFileIds([]);
    setSelectedLibraryIds([]);
    setPendingAttachments([]);
    setReplyToMessageId("");
    setEditingMessageId("");
    setEditingText("");
    void loadStudio(spaceId, "agents");
    void spacesApi.libraryItems(spaceId).then((result) => setLibraryItems(result.items)).catch(() => setLibraryItems([]));
  }, [loadStudio, spaceId, user?.id]);
  useEffect(() => {
    const messageId = searchParams.get("message");
    const target = messageId ? document.getElementById(`message-${messageId}`) : endRef.current;
    target?.scrollIntoView({ block: messageId ? "center" : "end" });
    const last = messages[messages.length - 1];
    if (last) void markRead(spaceId, last.seq);
  }, [markRead, messages, searchParams, spaceId]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = text.trim();
    if (!value && pendingAttachments.length === 0 && selectedLibraryIds.length === 0) return;
    try {
      await sendMessage(spaceId, value, selectedFileIds, pendingAttachments.map((item) => item.id), selectedLibraryIds, replyToMessageId);
      setText(""); setSelectedFileIds([]); setSelectedLibraryIds([]); setPendingAttachments([]); setReplyToMessageId("");
    } catch { /* store renders error */ }
  };

  const uploadAttachments = async (files: FileList | null) => {
    if (!files?.length || attachmentUploading) return;
    const available = Math.max(0, 5 - pendingAttachments.length - selectedLibraryIds.length);
    setAttachmentUploading(true);
    try {
      const uploaded: MessageAttachment[] = [];
      for (const file of Array.from(files).slice(0, available)) {
        const result = await spacesApi.uploadLibraryFile(spaceId, file, "attachment");
        if (result.attachment) uploaded.push(result.attachment);
      }
      setPendingAttachments((current) => [...current, ...uploaded]);
    } finally {
      setAttachmentUploading(false);
      if (attachmentInputRef.current) attachmentInputRef.current.value = "";
    }
  };

  const onComposerChange = (value: string) => {
    if (/(^|\s)@files\s*$/i.test(value)) {
      setText(value.replace(/(^|\s)@files\s*$/i, "$1"));
      attachmentInputRef.current?.click();
      return;
    }
    if (/(^|\s)@library\s*$/i.test(value)) {
      setText(value.replace(/(^|\s)@library\s*$/i, "$1"));
      setLibraryPickerOpen(true);
      return;
    }
    setText(value);
  };

  const beginEditing = (message: SpaceMessage) => {
    setEditingMessageId(message.id);
    setEditingText(message.content.map((span) => span.type === "text" ? span.text : `@${span.label}`).join(""));
  };

  const saveEditedMessage = async (event: FormEvent, message: SpaceMessage) => {
    event.preventDefault();
    const value = editingText.trim();
    if (!value || editSaving) return;
    setEditSaving(true);
    try {
      await updateMessage(spaceId, message.id, value, message.file_node_ids);
      setEditingMessageId("");
      setEditingText("");
    } catch { /* the page-level error renders the server response */ }
    finally { setEditSaving(false); }
  };

  return (
    <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto]">
      <div className="min-h-0 overflow-auto px-[clamp(24px,6vw,88px)] py-6">
        {messages.length === 0 ? (
          <div className="grid h-full place-items-center text-center">
            <div><span className="mx-auto grid size-12 place-items-center rounded-2xl bg-[var(--misty-surface-2)]"><MessageSquare size={22} /></span><h3 className="mb-1 mt-3">Start the conversation</h3><p className="m-0 text-sm text-[var(--misty-text-subtle)]">Mention a teammate or shared Agent with @name.</p></div>
          </div>
        ) : messages.map((message) => (
          <article className="group mb-5 grid grid-cols-[40px_minmax(0,1fr)_auto] gap-3" id={`message-${message.id}`} key={message.id}>
            <span className="grid size-10 place-items-center rounded-full bg-[var(--misty-surface-3)] text-xs font-bold">{message.sender_kind === "agent" ? "AI" : message.sender_name.slice(0, 2).toUpperCase()}</span>
            <div className="min-w-0">
              <div className="flex items-baseline gap-2"><strong className="text-sm">{message.sender_name}{message.sender_kind === "person" && message.sender_user_id === user?.id ? " (me)" : ""}</strong>{message.sender_kind === "agent" ? <span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-violet-300">Agent</span> : null}<time className="text-[10px] text-[var(--misty-text-subtle)]">{formatTime(message.created_at)}</time>{message.edited_at ? <span className="text-[10px] text-[var(--misty-text-subtle)]">Edited</span> : null}</div>
              {message.reply_to_message_id ? <button className="mt-1 block max-w-full truncate border-0 border-l-2 border-[var(--misty-primary)] bg-transparent pl-2 text-left text-[10px] text-[var(--misty-text-subtle)]" type="button" onClick={() => document.getElementById(`message-${message.reply_to_message_id}`)?.scrollIntoView({ block: "center" })}>Replying to {messages.find((item) => item.id === message.reply_to_message_id)?.sender_name ?? "a message"}</button> : null}
              {editingMessageId === message.id ? (
                <form className="mt-2 rounded-xl border border-[var(--misty-border-strong)] bg-[var(--misty-surface)] p-2" onSubmit={(event) => void saveEditedMessage(event, message)}>
                  <textarea className="min-h-[72px] w-full resize-y border-0 bg-transparent px-2 py-1 text-sm leading-relaxed text-[var(--misty-text)] outline-none" autoFocus maxLength={4000} value={editingText} onChange={(event) => setEditingText(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape" && !editSaving) { setEditingMessageId(""); setEditingText(""); } }} aria-label="Edit message" />
                  <div className="mt-1 flex justify-end gap-2"><button className={smallButtonClass} type="button" disabled={editSaving} onClick={() => { setEditingMessageId(""); setEditingText(""); }}>Cancel</button><button className={primaryButtonClass} type="submit" disabled={editSaving || !editingText.trim()}>{editSaving ? "Saving…" : "Save"}</button></div>
                </form>
              ) : <p className="m-0 mt-1 whitespace-pre-wrap text-sm leading-relaxed text-[var(--misty-text-muted)]">{message.content.map((span, index) => <MessageContent key={index} span={span} />)}</p>}
              {message.file_node_ids.length > 0 ? <div className="mt-2 flex flex-wrap gap-1.5">{message.file_node_ids.map((nodeId) => { const node = nodes.find((item) => item.id === nodeId); return <button className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] px-2 py-1 text-[10px] text-sky-200" type="button" key={nodeId} onClick={() => void openNode(spaceId, nodeId)}><Paperclip size={11}/>{node?.display_name ?? "Drive file"}</button>; })}</div> : null}
              {(message.library_item_ids?.length ?? 0) > 0 ? <div className="mt-2 flex flex-wrap gap-1.5">{message.library_item_ids?.map((itemId) => { const item = libraryItems.find((candidate) => candidate.id === itemId); return <button className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--misty-border-soft)] bg-violet-500/10 px-2 py-1 text-[10px] text-violet-200" type="button" key={itemId} disabled={!item} onClick={() => item && void spacesApi.downloadLibraryItem(spaceId, item.id, item.display_name)}><LibraryIcon size={11}/>{item?.display_name ?? "Unavailable Library item"}</button>; })}</div> : null}
              {(message.attachments?.length ?? 0) > 0 ? <div className="mt-2 flex flex-wrap gap-1.5">{message.attachments?.map((attachment) => <span className="inline-flex items-center gap-1 rounded-lg border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] p-1 pl-2 text-[10px]" key={attachment.id}><Paperclip size={11}/><button className="border-0 bg-transparent text-sky-200" type="button" onClick={() => void spacesApi.downloadAttachment(spaceId, attachment.id, attachment.display_name)}>{attachment.display_name}</button>{attachment.promoted_item_id ? <span className="px-1 text-[9px] text-emerald-300">In Library</span> : <button className="rounded-md border-0 bg-[var(--misty-surface-3)] px-1.5 py-0.5 text-[9px] text-[var(--misty-text-muted)]" type="button" onClick={() => void spacesApi.promoteAttachment(spaceId, attachment.id).then((item) => { setLibraryItems((current) => [...current.filter((candidate) => candidate.id !== item.id), item]); void loadMessages(spaceId); })}>Add to Library</button>}</span>)}</div> : null}
            </div>
            <div className="flex gap-1"><button className="invisible grid size-7 place-items-center rounded-lg border-0 bg-transparent text-[var(--misty-text-subtle)] hover:bg-[var(--misty-surface-2)] group-hover:visible focus:visible" type="button" onClick={() => setReplyToMessageId(message.id)} aria-label="Reply" title="Reply"><Reply size={14}/></button>{message.sender_kind === "person" && message.sender_user_id === user?.id ? <button className="invisible grid size-7 place-items-center rounded-lg border-0 bg-transparent text-[var(--misty-text-subtle)] hover:bg-[var(--misty-surface-2)] group-hover:visible focus:visible" type="button" onClick={() => beginEditing(message)} aria-label="Edit message" title="Edit message"><Pencil size={14}/></button> : null}{(message.sender_user_id === user?.id || useSpacesStore.getState().spaces.find((item) => item.id === spaceId)?.role === "owner") ? <button className="invisible grid size-7 place-items-center rounded-lg border-0 bg-transparent text-[var(--misty-text-subtle)] hover:bg-[var(--misty-surface-2)] group-hover:visible focus:visible" type="button" onClick={() => window.confirm("Remove this message?") && void deleteMessage(spaceId, message.id)} aria-label="Remove message" title="Remove message"><Trash2 size={14} /></button> : null}</div>
          </article>
        ))}
        <div ref={endRef} />
      </div>
      <form className="mx-[clamp(20px,5vw,72px)] mb-5 rounded-2xl border border-[var(--misty-border-strong)] bg-[var(--misty-surface)] p-2" onSubmit={(event) => void submit(event)}>
        {replyToMessageId ? <div className="mx-2 mt-1 flex items-center justify-between rounded-lg border-l-2 border-[var(--misty-primary)] bg-[var(--misty-surface-2)] px-3 py-1.5 text-[10px] text-[var(--misty-text-muted)]"><span>Replying to {messages.find((item) => item.id === replyToMessageId)?.sender_name ?? "message"}</span><button className="border-0 bg-transparent text-[var(--misty-text-subtle)]" type="button" onClick={() => setReplyToMessageId("")}><X size={12}/></button></div> : null}
        <textarea className="min-h-[54px] w-full resize-none border-0 bg-transparent px-3 py-2 text-sm text-[var(--misty-text)] outline-none" maxLength={4000} placeholder="Message this Space — use @files or @library" value={text} onChange={(event) => onComposerChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
        <div className="flex items-center justify-between gap-3 px-2 pb-1">
          <div className="flex min-w-0 items-center gap-1 overflow-auto">
            <input ref={attachmentInputRef} className="hidden" type="file" multiple onChange={(event) => void uploadAttachments(event.target.files)}/>
            <button className="grid size-7 shrink-0 place-items-center rounded-lg border-0 bg-[var(--misty-surface-2)] text-[var(--misty-text-muted)]" type="button" disabled={attachmentUploading || pendingAttachments.length + selectedLibraryIds.length >= 5} onClick={() => attachmentInputRef.current?.click()} title="@files — upload message attachments"><Paperclip size={13}/></button>
            <div className="relative">
              <button className="grid size-7 shrink-0 place-items-center rounded-lg border-0 bg-[var(--misty-surface-2)] text-[var(--misty-text-muted)]" type="button" onClick={() => setLibraryPickerOpen((open) => !open)} title="@library — reference this Space's Library"><LibraryIcon size={13}/></button>
              {libraryPickerOpen ? <div className="absolute bottom-9 left-0 z-30 max-h-56 w-64 overflow-auto rounded-xl border border-[var(--misty-border-strong)] bg-[var(--misty-surface)] p-1 shadow-2xl">{libraryItems.length === 0 ? <p className="m-0 px-3 py-2 text-[10px] text-[var(--misty-text-subtle)]">No Library items available.</p> : libraryItems.filter((item) => !selectedLibraryIds.includes(item.id)).map((item) => <button className="flex w-full items-center gap-2 rounded-lg border-0 bg-transparent px-2 py-2 text-left text-xs text-[var(--misty-text-muted)] hover:bg-[var(--misty-surface-2)]" type="button" key={item.id} onClick={() => { if (pendingAttachments.length + selectedLibraryIds.length < 5) setSelectedLibraryIds((current) => [...current, item.id]); setLibraryPickerOpen(false); }}><File size={13}/><span className="truncate">{item.display_name}</span></button>)}</div> : null}
            </div>
            {[...members.filter((member) => member.user_id !== user?.id), ...agents].slice(0, 6).map((item) => <button className="whitespace-nowrap rounded-md border-0 bg-[var(--misty-surface-2)] px-2 py-1 text-[10px] text-[var(--misty-text-muted)]" type="button" key={"user_id" in item ? item.user_id : item.id} onClick={() => setText((current) => `${current}${current && !current.endsWith(" ") ? " " : ""}@${item.name} `)}>@{item.name}</button>)}
          </div>
          <button className="grid size-8 shrink-0 place-items-center rounded-xl border-0 bg-[var(--misty-primary)] text-[var(--misty-primary-contrast)] disabled:opacity-50" disabled={sending || (!text.trim() && pendingAttachments.length === 0 && selectedLibraryIds.length === 0)} type="submit"><Send size={15} /></button>
        </div>
        {pendingAttachments.length > 0 || selectedLibraryIds.length > 0 ? <div className="flex flex-wrap gap-1 px-2 pb-1">{pendingAttachments.map((attachment) => <button className="rounded-md border-0 bg-sky-500/10 px-2 py-1 text-[9px] text-sky-200" type="button" key={attachment.id} onClick={() => setPendingAttachments((current) => current.filter((item) => item.id !== attachment.id))}>{attachment.display_name} ×</button>)}{selectedLibraryIds.map((id) => <button className="rounded-md border-0 bg-violet-500/10 px-2 py-1 text-[9px] text-violet-200" type="button" key={id} onClick={() => setSelectedLibraryIds((current) => current.filter((item) => item !== id))}>@library {libraryItems.find((item) => item.id === id)?.display_name ?? "item"} ×</button>)}</div> : null}
      </form>
    </div>
  );
}

function MessageContent({ span }: { span: MessageSpan }) {
  if (span.type === "text") return <>{span.text}</>;
  return <span className="rounded bg-violet-500/15 px-1 py-0.5 font-medium text-violet-300">@{span.label}</span>;
}

function SpaceLibrary({ spaceId, section }: { spaceId: string; section: string }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const activeSpace = useSpacesStore((state) => state.spaces.find((space) => space.id === spaceId));
  const availableSpaces = useSpacesStore((state) => state.spaces);
  const [items, setItems] = useState<SpaceLibraryItem[]>([]);
  const [visibleItems, setVisibleItems] = useState<SpaceLibraryItem[]>([]);
  const [usage, setUsage] = useState<SpaceStorageUsage | null>(null);
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
  const [gridSize, setGridSize] = useState(180);
  const [squareGrid, setSquareGrid] = useState(false);
  const [sort, setSort] = useState<NonNullable<LibraryItemQuery["sort"]>>("recently-added");
  const [direction, setDirection] = useState<NonNullable<LibraryItemQuery["direction"]>>("desc");
  const [reloadKey, setReloadKey] = useState(0);
  const [nextAfter, setNextAfter] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [localError, setLocalError] = useState("");
  const [selectedItemId, setSelectedItemId] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [bulkSaving, setBulkSaving] = useState(false);
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
  const selectedItems = useMemo(() => visibleItems.filter((item) => selectedItemIds.includes(item.id)), [selectedItemIds, visibleItems]);
  const currentAlbum = useMemo(() => collection === "albums" && selectedCollectionId ? albums.find((album) => album.id === selectedCollectionId) ?? null : null, [albums, collection, selectedCollectionId]);
  const currentAlbumFolder = useMemo(() => albumFolders.find((folder) => folder.id === selectedAlbumFolderId) ?? null, [albumFolders, selectedAlbumFolderId]);
  const visibleAlbumFolders = useMemo(() => albumFolders.filter((folder) => (folder.parent_folder_id ?? "") === selectedAlbumFolderId), [albumFolders, selectedAlbumFolderId]);
  const visibleAlbumsForFolder = useMemo(() => albums.filter((album) => (album.folder_id ?? "") === selectedAlbumFolderId), [albums, selectedAlbumFolderId]);
  const currentGroup = useMemo(() => collection === "groups" && selectedCollectionId ? groups.find((group) => group.id === selectedCollectionId) ?? null : null, [collection, groups, selectedCollectionId]);
  const currentPerson = useMemo(() => collection === "people" && selectedCollectionId ? people.find((person) => person.id === selectedCollectionId) ?? null : null, [collection, people, selectedCollectionId]);
  const currentDiscoveryGroup = useMemo(() => collection === "memory" ? discovery.memories.find((group) => group.id === selectedCollectionId) ?? null : collection === "trip" ? discovery.trips.find((group) => group.id === selectedCollectionId) ?? null : collection === "duplicate" ? discovery.duplicates.find((group) => group.id === selectedCollectionId) ?? null : null, [collection, discovery, selectedCollectionId]);
  const currentDateGroup = useMemo(() => collection === "recent-days" ? discovery.recent_days.find((group) => group.id === selectedCollectionId) ?? null : collection === "months" ? discovery.months.find((group) => group.id === selectedCollectionId) ?? null : collection === "years" ? discovery.years.find((group) => group.id === selectedCollectionId) ?? null : null, [collection, discovery.months, discovery.recent_days, discovery.years, selectedCollectionId]);
  const currentMapPoint = useMemo(() => collection === "map" && selectedCollectionId ? discovery.map_points.find((point) => point.id === selectedCollectionId) ?? null : null, [collection, discovery.map_points, selectedCollectionId]);
  const canReorderAlbum = Boolean(currentAlbum && currentAlbum.sort_mode === "custom" && sort === "album-order" && !searchQuery && !mediaType && currentAlbum.item_count === visibleItems.length);

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
    void Promise.all([spacesApi.libraryUsage(spaceId), spacesApi.albums(spaceId), spacesApi.albumFolders(spaceId).catch(() => ({ folders: [] })), spacesApi.groups(spaceId).catch(() => ({ groups: [] })), spacesApi.peoplePolicy(spaceId).catch(() => null), spacesApi.people(spaceId).catch(() => ({ people: [] })), spacesApi.libraryDiscovery(spaceId).catch(() => ({ recent_days: [], months: [], years: [], memories: [], trips: [], duplicates: [], map_points: [] })), spacesApi.sharedReferences(spaceId).catch(() => ({ references: [], outgoing: [] })), spacesApi.libraryPins(spaceId).catch(() => ({ pins: [] })), spacesApi.libraryImportHistory(spaceId).catch(() => ({ imports: [] }))]).then(([currentUsage, albumResult, folderResult, groupResult, policyResult, peopleResult, discoveryResult, sharedResult, pinResult, importResult]) => {
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
    }).catch((error: unknown) => current && setLocalError(error instanceof Error ? error.message : "Library could not be loaded."));
    return () => { current = false; };
  }, [reloadKey, spaceId]);

  useEffect(() => {
    let current = true;
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
        : spacesApi.libraryItems(spaceId, libraryQuery);
    void request.then((library) => {
      if (!current) return;
      let nextItems = library.items;
      if (collection === "recent-days" || collection === "months" || collection === "years" || collection === "people" || collection === "groups" || collection === "memory" || collection === "trip" || collection === "map" || collection === "duplicate" || collection === "albums" && selectedCollectionId) {
        const normalizedSearch = searchQuery.toLocaleLowerCase();
        nextItems = nextItems.filter((item) => {
          const mime = String(item.file.intrinsic_metadata.server_detected_mime_type ?? "");
          const matchesSearch = !normalizedSearch || [item.display_name, item.caption, item.tags.join(" "), item.file.original_filename].join(" ").toLocaleLowerCase().includes(normalizedSearch);
          const matchesMedia = !mediaType || mediaType === "document" ? !mediaType || !/^(image|video|audio)\//.test(mime) : mime.startsWith(`${mediaType}/`);
          return matchesSearch && matchesMedia;
        });
        if (sort !== "album-order") nextItems.sort((left, right) => compareLibraryItems(left, right, sort, direction));
      }
      setItems(nextItems);
      setVisibleItems(nextItems);
      setNextAfter(collection === "recent-days" || collection === "months" || collection === "years" || collection === "people" || collection === "groups" || collection === "memory" || collection === "trip" || collection === "map" || collection === "duplicate" || collection === "albums" && selectedCollectionId ? "" : (library as { next_after?: string }).next_after ?? "");
    }).catch((error: unknown) => current && setLocalError(error instanceof Error ? error.message : "Library could not be loaded.")).finally(() => current && setLoading(false));
    return () => { current = false; };
  }, [collection, libraryQuery, mediaType, peoplePolicy?.semantic_search_enabled, reloadKey, searchQuery, selectedCollectionId, sort, direction, spaceId]);

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
    setSelecting(false);
  }, [collection, mediaType, searchQuery, selectedCollectionId, sort, direction, spaceId]);

  const reload = async () => {
    const [currentUsage, albumResult, folderResult, groupResult, policyResult, peopleResult, discoveryResult, sharedResult, pinResult, importResult] = await Promise.all([spacesApi.libraryUsage(spaceId), spacesApi.albums(spaceId), spacesApi.albumFolders(spaceId).catch(() => ({ folders: [] })), spacesApi.groups(spaceId).catch(() => ({ groups: [] })), spacesApi.peoplePolicy(spaceId).catch(() => null), spacesApi.people(spaceId).catch(() => ({ people: [] })), spacesApi.libraryDiscovery(spaceId).catch(() => ({ recent_days: [], months: [], years: [], memories: [], trips: [], duplicates: [], map_points: [] })), spacesApi.sharedReferences(spaceId).catch(() => ({ references: [], outgoing: [] })), spacesApi.libraryPins(spaceId).catch(() => ({ pins: [] })), spacesApi.libraryImportHistory(spaceId).catch(() => ({ imports: [] }))]);
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
    setReloadKey((current) => current + 1);
  };

  const loadMore = async () => {
    if (!nextAfter || loadingMore || collection === "groups") return;
    setLoadingMore(true);
    try {
      const result = await spacesApi.libraryItems(spaceId, { ...libraryQuery, after: nextAfter });
      setItems((current) => [...current, ...result.items]);
      setVisibleItems((current) => [...current, ...result.items]);
      setNextAfter(result.next_after ?? "");
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "More Library items could not be loaded.");
    } finally {
      setLoadingMore(false);
    }
  };

  const uploadFiles = async (files: FileList | null) => {
    if (!files?.length || uploading) return;
    setUploading(true);
    setLocalError("");
    try {
      for (const file of Array.from(files)) await spacesApi.uploadLibraryFile(spaceId, file, "library");
      await reload();
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const updateItem = async (item: SpaceLibraryItem, patch: Partial<Pick<SpaceLibraryItem, "display_name" | "caption" | "favorite" | "hidden" | "tags">>) => {
    try {
      const saved = await spacesApi.updateLibraryItem(spaceId, item, patch);
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
    if (!window.confirm(`Move “${item.display_name}” to Recently Deleted?`)) return false;
    try {
      await spacesApi.trashLibraryItem(spaceId, item.id);
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
    try {
      await spacesApi.restoreLibraryItem(spaceId, item.id);
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
    if (selectedItems.length === 0 || bulkSaving) return false;
    if (action === "trash" && !window.confirm(`Move ${selectedItems.length} selected item${selectedItems.length === 1 ? "" : "s"} to Recently Deleted?`)) return false;
    setBulkSaving(true);
    setLocalError("");
    try {
      await spacesApi.bulkLibraryItems(spaceId, selectedItems, action, options);
      setSelectedItemIds([]);
      setSelecting(false);
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
    if (!window.confirm(`Clear ${label} from ${selectedItems.length} selected item${selectedItems.length === 1 ? "" : "s"}?`)) return;
    await applyBulkAction(action);
  };

  const exportSelectedItems = async () => {
    if (selectedItems.length === 0 || bulkSaving) return;
    setBulkSaving(true);
    setLocalError("");
    try {
      await spacesApi.exportLibraryItems(spaceId, selectedItems.map((item) => item.id));
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Selected Library items could not be exported.");
    } finally {
      setBulkSaving(false);
    }
  };

  const copySelectedItems = async (destinationSpaceId: string) => {
    if (!destinationSpaceId || selectedItems.length === 0 || bulkSaving) return;
    setBulkSaving(true);
    setLocalError("");
    try {
      await spacesApi.importLibraryItems(spaceId, destinationSpaceId, selectedItems.map((item) => item.id));
      setSelectedItemIds([]);
      setSelecting(false);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Selected Library items could not be copied.");
    } finally {
      setBulkSaving(false);
    }
  };

  const shareSelectedItems = async (destinationSpaceId: string) => {
    if (!destinationSpaceId || selectedItems.length === 0 || bulkSaving) return;
    setBulkSaving(true);
    setLocalError("");
    try {
      await spacesApi.shareLibraryItems(spaceId, destinationSpaceId, selectedItems.map((item) => item.id));
      setSelectedItemIds([]);
      setSelecting(false);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Selected Library items could not be shared.");
    } finally {
      setBulkSaving(false);
    }
  };

  const mergeCurrentDuplicates = async () => {
    if (collection !== "duplicate" || visibleItems.length < 2 || bulkSaving || !window.confirm(`Merge ${visibleItems.length} matching items? Misty will keep one item, combine metadata and references, and move the redundant copies to Recently Deleted.`)) return;
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
    if (!window.confirm(`Stop sharing “${reference.display_name}” with ${reference.destination_space_name}?`)) return;
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
    if (next === "albums" && id) {
      setSort("album-order");
      setDirection("asc");
    } else if (sort === "album-order") {
      setSort("recently-added");
      setDirection("desc");
    }
  };

  const isPinned = (kind: LibraryPinnedCollection["target_kind"], id: string) => pins.some((pin) => pin.target_kind === kind && pin.target_id === id);

  const togglePin = async (kind: LibraryPinnedCollection["target_kind"], id: string) => {
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
    if (!currentDiscoveryGroup || currentDiscoveryGroup.kind !== "memory") return;
    try {
      const saved = await spacesApi.updateMemoryPreference(spaceId, currentDiscoveryGroup, patch);
      setDiscovery((current) => ({ ...current, memories: current.memories.map((memory) => memory.id === saved.id ? saved : memory) }));
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Memory could not be updated.");
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
    setAlbumName("");
    setAlbumDescription("");
    setAlbumCoverItemId("");
    setAlbumDialogMode("create");
  };

  const openEditAlbum = () => {
    if (!currentAlbum) return;
    setAlbumName(currentAlbum.name);
    setAlbumDescription(currentAlbum.description);
    setAlbumCoverItemId(currentAlbum.cover_item_id ?? "");
    setAlbumDialogMode("edit");
  };

  const saveAlbum = async (event: FormEvent) => {
    event.preventDefault();
    const name = albumName.trim();
    if (!name || albumSaving) return;
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

  const createAlbumFolder = async () => {
    const name = window.prompt("Folder name")?.trim();
    if (!name) return;
    try {
      const folder = await spacesApi.createAlbumFolder(spaceId, name, selectedAlbumFolderId);
      setAlbumFolders((current) => [...current, folder].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name)));
      setSelectedAlbumFolderId(folder.id);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Album folder could not be created.");
    }
  };

  const renameAlbumFolder = async () => {
    const folder = albumFolders.find((candidate) => candidate.id === selectedAlbumFolderId);
    if (!folder) return;
    const name = window.prompt("Folder name", folder.name)?.trim();
    if (!name || name === folder.name) return;
    try {
      const saved = await spacesApi.updateAlbumFolder(spaceId, folder, { name });
      setAlbumFolders((current) => current.map((candidate) => candidate.id === saved.id ? saved : candidate));
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Album folder could not be renamed.");
    }
  };

  const deleteAlbumFolder = async () => {
    const folder = albumFolders.find((candidate) => candidate.id === selectedAlbumFolderId);
    if (!folder || !window.confirm(`Delete “${folder.name}”? Albums will move to the top level.`)) return;
    try {
      await spacesApi.deleteAlbumFolder(spaceId, folder);
      setAlbumFolders((current) => current.filter((candidate) => candidate.id !== folder.id && candidate.parent_folder_id !== folder.id));
      setAlbums((current) => current.map((album) => album.folder_id === folder.id ? { ...album, folder_id: undefined } : album));
      setSelectedAlbumFolderId(folder.parent_folder_id ?? "");
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Album folder could not be deleted.");
    }
  };

  const organizeCurrentAlbum = async (patch: Partial<Pick<LibraryAlbum, "folder_id" | "view_mode" | "sort_mode">>) => {
    if (!currentAlbum) return;
    try {
      const saved = await spacesApi.organizeAlbum(spaceId, currentAlbum, patch);
      setAlbums((current) => current.map((album) => album.id === saved.id ? saved : album));
      if (patch.sort_mode) setReloadKey((current) => current + 1);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Album organization could not be updated.");
    }
  };

  const deleteCurrentAlbum = async () => {
    if (!currentAlbum || !window.confirm(`Delete “${currentAlbum.name}”? Its Library items will not be deleted.`)) return;
    try {
      await spacesApi.deleteAlbum(spaceId, currentAlbum);
      setAlbums((current) => current.filter((album) => album.id !== currentAlbum.id));
      selectCollection("collections");
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Album could not be deleted.");
    }
  };

  const reorderAlbumItem = async (targetItemId: string) => {
    if (!currentAlbum || !canReorderAlbum || !draggedAlbumItemId || draggedAlbumItemId === targetItemId) return;
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
    if (!peoplePolicy) return;
    try {
      const saved = await spacesApi.updatePeoplePolicy(spaceId, peoplePolicy, kind === "person" ? { faces_enabled: !peoplePolicy.faces_enabled } : { pets_enabled: !peoplePolicy.pets_enabled });
      setPeoplePolicy(saved);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "People & Pets settings could not be updated.");
    }
  };

  const toggleIntelligencePolicy = async (kind: "ocr" | "ai" | "semantic") => {
    if (!peoplePolicy) return;
    const patch = kind === "ocr"
      ? { ocr_enabled: !peoplePolicy.ocr_enabled }
      : kind === "ai"
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
    setPersonKind(kind);
    setPersonName("");
    setPersonCoverItemId("");
    setPersonDialogMode("create");
  };

  const openEditPerson = () => {
    if (!currentPerson) return;
    setPersonKind(currentPerson.kind);
    setPersonName(currentPerson.name);
    setPersonCoverItemId(currentPerson.cover_item_id ?? "");
    setPersonDialogMode("edit");
  };

  const savePerson = async (event: FormEvent) => {
    event.preventDefault();
    if (personSaving) return;
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
    if (!currentPerson || !window.confirm(`Remove “${currentPerson.name || (currentPerson.kind === "pet" ? "Unnamed pet" : "Unnamed person")}" from People & Pets? Library items will not be deleted.`)) return;
    try {
      await spacesApi.deletePerson(spaceId, currentPerson);
      setPeople((current) => current.filter((person) => person.id !== currentPerson.id));
      selectCollection("people");
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Person or pet could not be removed.");
    }
  };

  const mergeCurrentPerson = async (targetID: string) => {
    if (!currentPerson || !targetID) return;
    const target = people.find((person) => person.id === targetID);
    if (!target || !window.confirm(`Merge “${currentPerson.name || "Unnamed"}” into “${target.name || "Unnamed"}”?`)) return;
    try {
      const saved = await spacesApi.mergePeople(spaceId, currentPerson, target);
      setPeople((current) => current.filter((person) => person.id !== currentPerson.id).map((person) => person.id === saved.id ? saved : person));
      selectCollection("people", saved.id);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "People could not be merged.");
    }
  };

  const applyPersonItems = async (personID: string, remove = false) => {
    if (selectedItems.length === 0 || bulkSaving) return;
    setBulkSaving(true);
    try {
      const saved = remove ? await spacesApi.removePersonItems(spaceId, personID, selectedItems.map((item) => item.id)) : await spacesApi.addPersonItems(spaceId, personID, selectedItems.map((item) => item.id));
      setPeople((current) => current.map((person) => person.id === saved.id ? saved : person));
      setSelectedItemIds([]);
      setSelecting(false);
      setReloadKey((current) => current + 1);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Selected items could not be assigned.");
    } finally {
      setBulkSaving(false);
    }
  };

  const createGroup = async () => {
    const name = window.prompt("Group name")?.trim();
    if (!name) return;
    const tag = window.prompt("Match files with this tag")?.trim();
    if (!tag) return;
    try {
      const group = await spacesApi.createGroup(spaceId, name, [{ field: "tag", op: "contains", value: tag }]);
      setGroups((current) => [...current, group].sort((a, b) => a.name.localeCompare(b.name)));
      selectCollection("groups", group.id);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Group could not be created.");
    }
  };

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_auto_minmax(0,1fr)]">
      <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-b border-[var(--misty-border-soft)] px-6 py-2">
        <div className="flex items-center gap-2"><LibraryIcon size={18}/><h3 className="m-0 text-base">Library</h3></div>
        <div className="flex items-center gap-3">
          <SpaceSectionNavigation spaceId={spaceId} section={section}/>
        </div>
      </div>
      <nav className="flex items-center gap-1 overflow-x-auto border-b border-[var(--misty-border-soft)] px-6 py-2" aria-label="Library collections">
        <input ref={inputRef} className="hidden" type="file" multiple onChange={(event) => void uploadFiles(event.target.files)} />
        <button className={`${primaryButtonClass} mr-2 h-8 min-h-8 shrink-0`} type="button" disabled={uploading || (usage?.remaining_bytes ?? 1) <= 0} onClick={() => inputRef.current?.click()}><Upload size={14}/>{uploading ? "Uploading…" : "Upload"}</button>
        {([{ id: "recent", label: "Recently Added" }, { id: "months", label: "Months" }, { id: "years", label: "Years" }, { id: "collections", label: "Collections" }] as const).map(({ id, label }) => <button className={`rounded-lg border-0 px-3 py-1.5 text-xs ${collection === id ? "bg-[var(--misty-surface-3)] text-[var(--misty-text)]" : "bg-transparent text-[var(--misty-text-muted)] hover:bg-[var(--misty-surface-2)] hover:text-[var(--misty-text)]"}`} type="button" key={id} onClick={() => selectCollection(id)}>{label}</button>)}
        <div className="ml-auto flex items-center gap-2 pl-3">
          <label className="flex h-8 w-44 shrink-0 items-center gap-2 rounded-lg border border-[var(--misty-border-soft)] bg-[var(--misty-surface)] px-2 text-[var(--misty-text-muted)]"><Search size={13}/><input className="min-w-0 flex-1 border-0 bg-transparent text-xs text-[var(--misty-text)] outline-none placeholder:text-[var(--misty-text-subtle)]" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} onFocus={() => setSearchFocused(true)} onBlur={() => window.setTimeout(() => setSearchFocused(false), 120)} placeholder="Search" aria-label="Search Library"/>{searchInput ? <button className="grid size-5 shrink-0 place-items-center border-0 bg-transparent p-0 text-[var(--misty-text-subtle)]" type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => setSearchInput("")} aria-label="Clear Library search"><X size={11}/></button> : null}</label>
          <select className={libraryControlClass} value={mediaType} onChange={(event) => setMediaType(event.target.value as typeof mediaType)} aria-label="Filter by media type"><option value="">All media</option><option value="image">Images</option><option value="video">Videos</option><option value="audio">Audio</option><option value="document">Documents</option><option value="selfies">Selfies</option><option value="live-photos">Live Photos</option><option value="portraits">Portraits</option><option value="panoramas">Panoramas</option><option value="slo-mo">Slo-mo</option><option value="cinematic">Cinematic</option><option value="bursts">Bursts</option><option value="screenshots">Screenshots</option><option value="screen-recordings">Screen Recordings</option><option value="spatial">Spatial</option></select>
          <select className={libraryControlClass} value={["favorites", "hidden", "deleted"].includes(collection) ? collection : ""} onChange={(event) => selectCollection((event.target.value || "recent") as "recent" | "favorites" | "hidden" | "deleted")} aria-label="Choose a Library utility"><option value="">More</option><option value="favorites">Favorites</option><option value="hidden">Hidden</option><option value="deleted">Recently Deleted</option></select>
          <select className={libraryControlClass} value={`${sort}:${direction}`} onChange={(event) => { const [nextSort, nextDirection] = event.target.value.split(":") as [typeof sort, typeof direction]; setSort(nextSort); setDirection(nextDirection); }} aria-label="Sort Library">{currentAlbum ? <option value="album-order:asc">Album order</option> : null}<option value="recently-added:desc">Newest added</option><option value="recently-added:asc">Oldest added</option><option value="date-captured:desc">Newest captured</option><option value="date-captured:asc">Oldest captured</option><option value="name:asc">Name A–Z</option><option value="name:desc">Name Z–A</option><option value="size:desc">Largest</option><option value="size:asc">Smallest</option></select>
          <div className="flex h-8 shrink-0 items-center rounded-lg border border-[var(--misty-border-soft)] bg-[var(--misty-surface)]"><button className="grid size-7 place-items-center border-0 bg-transparent p-0 text-[var(--misty-text-muted)] disabled:opacity-30" type="button" disabled={gridSize <= 120} onClick={() => setGridSize((current) => Math.max(120, current - 30))} aria-label="Show smaller Library thumbnails"><ZoomOut size={13}/></button><button className="grid size-7 place-items-center border-0 bg-transparent p-0 text-[var(--misty-text-muted)] disabled:opacity-30" type="button" disabled={gridSize >= 300} onClick={() => setGridSize((current) => Math.min(300, current + 30))} aria-label="Show larger Library thumbnails"><ZoomIn size={13}/></button><button className={`h-6 border-0 px-2 text-[10px] ${squareGrid ? "bg-[var(--misty-surface-3)] text-[var(--misty-text)]" : "bg-transparent text-[var(--misty-text-muted)]"}`} type="button" onClick={() => setSquareGrid((current) => !current)} aria-label="Toggle square Library thumbnails">1:1</button></div>
          <button className={`${secondaryButtonClass} h-8 min-h-8 shrink-0`} type="button" disabled={visibleItems.length === 0} onClick={() => { setSelecting((current) => !current); setSelectedItemIds([]); setSelectedItemId(""); }}>{selecting ? "Cancel" : "Select"}</button>
        </div>
      </nav>
      <div className="min-h-0 overflow-auto p-6">
        {searchFocused && (searchFacets.tags.length > 0 || searchFacets.media_types.length > 0 || searchFacets.years.length > 0 || searchFacets.albums.length > 0 || searchFacets.utilities.length > 0) ? <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface)] p-3" onMouseDown={(event) => event.preventDefault()}>
          {searchFacets.media_types.length > 0 ? <LibraryFacetGroup label="Media" facets={searchFacets.media_types} onSelect={(facet) => appendSearchFacet("type", facet.value)}/> : null}
          {searchFacets.tags.length > 0 ? <LibraryFacetGroup label="Tags" facets={searchFacets.tags} onSelect={(facet) => appendSearchFacet("tag", facet.value)}/> : null}
          {searchFacets.albums.length > 0 ? <LibraryFacetGroup label="Albums" facets={searchFacets.albums} onSelect={(facet) => appendSearchFacet("album", facet.label)}/> : null}
          {searchFacets.years.length > 0 ? <LibraryFacetGroup label="Years" facets={searchFacets.years} onSelect={(facet) => appendSearchFacet("year", facet.value)}/> : null}
          {searchFacets.utilities.length > 0 ? <LibraryFacetGroup label="Utilities" facets={searchFacets.utilities} onSelect={(facet) => selectCollection("utility", facet.value)}/> : null}
        </div> : null}
        {selecting && visibleItems.length > 0 ? <div className="mb-4 flex min-h-10 flex-wrap items-center gap-2 rounded-xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface)] px-3 py-2">
          <span className="mr-1 text-xs font-medium">{selectedItems.length} selected</span>
          <button className={smallButtonClass} type="button" disabled={bulkSaving} onClick={() => setSelectedItemIds(selectedItems.length === visibleItems.length ? [] : visibleItems.map((item) => item.id))}>{selectedItems.length === visibleItems.length ? "Deselect all" : "Select all"}</button>
          {collection === "deleted" ? <button className={smallButtonClass} type="button" disabled={bulkSaving || selectedItems.length === 0} onClick={() => void applyBulkAction("restore")}>Restore</button> : <>
            <button className={smallButtonClass} type="button" disabled={bulkSaving || selectedItems.length === 0} onClick={() => void applyBulkAction(collection === "favorites" ? "unfavorite" : "favorite")}><Star size={12}/>{collection === "favorites" ? "Unfavorite" : "Favorite"}</button>
            <button className={smallButtonClass} type="button" disabled={bulkSaving || selectedItems.length === 0} onClick={() => void applyBulkAction(collection === "hidden" ? "unhide" : "hide")}><EyeOff size={12}/>{collection === "hidden" ? "Unhide" : "Hide"}</button>
            {collection === "albums" && selectedCollectionId ? <button className={smallButtonClass} type="button" disabled={bulkSaving || selectedItems.length === 0} onClick={() => void applyBulkAction("remove_from_album", { albumId: selectedCollectionId })}>Remove from album</button> : null}
            {albums.length > 0 ? <select className={libraryControlClass} value="" disabled={bulkSaving || selectedItems.length === 0} onChange={(event) => { if (event.target.value) void applyBulkAction("add_to_album", { albumId: event.target.value }); }} aria-label="Add selected items to album"><option value="">Add to album…</option>{albums.map((album) => <option value={album.id} key={album.id}>{album.name}</option>)}</select> : null}
            <select className={libraryControlClass} value="" disabled={bulkSaving || selectedItems.length === 0} onChange={(event) => { const action = event.target.value; if (action === "add_tags" || action === "remove_tags" || action === "set_date" || action === "set_location") openMetadataDialog(action); else if (action === "clear_date") void clearBulkMetadata("clear_date", "the adjusted date"); else if (action === "clear_location") void clearBulkMetadata("clear_location", "the location"); }} aria-label="Adjust selected item metadata"><option value="">Adjust…</option><option value="add_tags">Add tags</option><option value="remove_tags">Remove tags</option><option value="set_date">Adjust date</option><option value="clear_date">Clear adjusted date</option><option value="set_location">Set location</option><option value="clear_location">Clear location</option></select>
            <button className={smallButtonClass} type="button" disabled={bulkSaving || selectedItems.length === 0} onClick={() => void exportSelectedItems()}><Download size={12}/>Export</button>
            {availableSpaces.some((space) => space.id !== spaceId) ? <select className={libraryControlClass} value="" disabled={bulkSaving || selectedItems.length === 0} onChange={(event) => { if (event.target.value) void copySelectedItems(event.target.value); }} aria-label="Copy selected items to another Space"><option value="">Copy to Space…</option>{availableSpaces.filter((space) => space.id !== spaceId).map((space) => <option value={space.id} key={space.id}>{space.name}</option>)}</select> : null}
            {availableSpaces.some((space) => space.id !== spaceId) ? <select className={libraryControlClass} value="" disabled={bulkSaving || selectedItems.length === 0} onChange={(event) => { if (event.target.value) void shareSelectedItems(event.target.value); }} aria-label="Share selected items with another Space"><option value="">Share to Space…</option>{availableSpaces.filter((space) => space.id !== spaceId).map((space) => <option value={space.id} key={space.id}>{space.name}</option>)}</select> : null}
            {currentPerson ? <button className={smallButtonClass} type="button" disabled={bulkSaving || selectedItems.length === 0} onClick={() => void applyPersonItems(currentPerson.id, true)}>Remove from {currentPerson.kind === "pet" ? "pet" : "person"}</button> : people.length > 0 && selectedItems.length > 0 && selectedItems.every((item) => String(item.file.intrinsic_metadata.server_detected_mime_type ?? "").startsWith("image/")) ? <select className={libraryControlClass} value="" disabled={bulkSaving} onChange={(event) => { if (event.target.value) void applyPersonItems(event.target.value); }} aria-label="Assign selected images to a person or pet"><option value="">Add to People & Pets…</option>{people.filter((person) => person.kind === "person" ? peoplePolicy?.faces_enabled : peoplePolicy?.pets_enabled).map((person) => <option value={person.id} key={person.id}>{person.name || (person.kind === "pet" ? "Unnamed pet" : "Unnamed person")}</option>)}</select> : null}
            <button className={smallButtonClass} type="button" disabled={bulkSaving || selectedItems.length === 0} onClick={() => void applyBulkAction("trash")}><Trash2 size={12}/>Delete</button>
          </>}
        </div> : null}
        {localError ? <button className="mb-4 rounded-xl border border-red-400/20 bg-red-950/20 px-3 py-2 text-left text-xs text-red-200" type="button" onClick={() => setLocalError("")}>{localError}</button> : null}
        {(collection === "months" || collection === "years" || collection === "recent-days") && !selectedCollectionId ? <div className="mb-5"><div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3">{(collection === "months" ? discovery.months : collection === "years" ? discovery.years : discovery.recent_days).map((group) => <LibraryDiscoveryCard key={`${group.kind}:${group.id}`} spaceId={spaceId} group={group} fallbackIcon={collection === "years" ? History : LibraryIcon} onClick={() => selectCollection(collection, group.id)}/>)}</div>{(collection === "months" ? discovery.months : collection === "years" ? discovery.years : discovery.recent_days).length === 0 ? <div className="grid min-h-48 place-items-center text-sm text-[var(--misty-text-subtle)]">Nothing to see here...</div> : null}</div> : null}
        {collection === "collections" ? <div className="grid gap-7">
          {pins.length > 0 ? <section><h4 className="mb-3 mt-0 text-sm">Pinned</h4><div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">{pins.map((pin, index) => { const descriptor = pinnedDescriptor(pin); return descriptor ? <LibraryCollectionCard key={pin.id} {...descriptor} pinned onMoveEarlier={index > 0 ? () => void movePin(pin.id, -1) : undefined} onMoveLater={index < pins.length - 1 ? () => void movePin(pin.id, 1) : undefined} onTogglePin={() => void togglePin(pin.target_kind, pin.target_id)}/> : null; })}</div></section> : null}
          <section><h4 className="mb-3 mt-0 text-sm">Collections</h4><div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
            <LibraryCollectionCard icon={LibraryIcon} label="Recently Added" count={searchFacets.total} pinned={isPinned("system", "recent")} onTogglePin={() => void togglePin("system", "recent")} onClick={() => selectCollection("recent")}/>
            <LibraryCollectionCard icon={Star} label="Favorites" count={searchFacets.favorites} pinned={isPinned("system", "favorites")} onTogglePin={() => void togglePin("system", "favorites")} onClick={() => selectCollection("favorites")}/>
            <LibraryCollectionCard icon={Users} label="People & Pets" count={people.length} disabled={!peoplePolicy} pinned={isPinned("system", "people")} onTogglePin={() => void togglePin("system", "people")} onClick={() => selectCollection("people")}/>
            {discovery.map_points.length > 0 ? <LibraryCollectionCard icon={MapIcon} label="Map" count={discovery.map_points.reduce((total, point) => total + point.item_count, 0)} pinned={isPinned("system", "map")} onTogglePin={() => void togglePin("system", "map")} onClick={() => selectCollection("map")}/> : null}
            {sharedReferences.length + outgoingReferences.length > 0 ? <LibraryCollectionCard icon={MessagesSquare} label="Shared" count={sharedReferences.length + outgoingReferences.length} pinned={isPinned("system", "shared")} onTogglePin={() => void togglePin("system", "shared")} onClick={() => selectCollection("shared")}/> : null}
            {importHistory.length > 0 ? <LibraryCollectionCard icon={History} label="Imports" count={importHistory.length} pinned={isPinned("system", "imports")} onTogglePin={() => void togglePin("system", "imports")} onClick={() => selectCollection("imports")}/> : null}
            {discovery.duplicates.length > 0 ? <LibraryCollectionCard icon={Copy} label="Duplicates" count={discovery.duplicates.reduce((total, group) => total + group.item_count, 0)} onClick={() => selectCollection("duplicate")}/> : null}
            <LibraryCollectionCard icon={EyeOff} label="Hidden" count={searchFacets.hidden} pinned={isPinned("system", "hidden")} onTogglePin={() => void togglePin("system", "hidden")} onClick={() => selectCollection("hidden")}/>
            <LibraryCollectionCard icon={Trash2} label="Recently Deleted" count={searchFacets.recently_deleted} pinned={isPinned("system", "deleted")} onTogglePin={() => void togglePin("system", "deleted")} onClick={() => selectCollection("deleted")}/>
          </div></section>
          {discovery.recent_days.length > 0 ? <section><h4 className="mb-3 mt-0 text-sm">Recent Days</h4><div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">{discovery.recent_days.slice(0, 12).map((group) => <LibraryDiscoveryCard key={group.id} spaceId={spaceId} group={group} fallbackIcon={LibraryIcon} onClick={() => selectCollection("recent-days", group.id)}/>)}</div></section> : null}
          {discovery.memories.length > 0 ? <section><h4 className="mb-3 mt-0 text-sm">Memories</h4><div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">{discovery.memories.map((group) => <LibraryDiscoveryCard key={group.id} spaceId={spaceId} group={group} fallbackIcon={Sparkles} pinned={isPinned("memory", group.id)} onTogglePin={() => void togglePin("memory", group.id)} onClick={() => selectCollection("memory", group.id)}/>)}</div></section> : null}
          {discovery.trips.length > 0 ? <section><h4 className="mb-3 mt-0 text-sm">Trips</h4><div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">{discovery.trips.map((group) => <LibraryDiscoveryCard key={group.id} spaceId={spaceId} group={group} fallbackIcon={MapPin} pinned={isPinned("trip", group.id)} onTogglePin={() => void togglePin("trip", group.id)} onClick={() => selectCollection("trip", group.id)}/>)}</div></section> : null}
          <section><h4 className="mb-3 mt-0 text-sm">Media Types</h4><div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">{searchFacets.media_types.map((facet) => <LibraryCollectionCard icon={facet.value === "image" ? ImageIcon : facet.value === "video" ? Video : facet.value === "audio" ? Music2 : File} label={facet.label} count={facet.count} key={facet.value} pinned={isPinned("system", facet.value)} onTogglePin={() => void togglePin("system", facet.value)} onClick={() => { setMediaType(facet.value as typeof mediaType); selectCollection("recent"); }}/>)}</div></section>
          {searchFacets.utilities.length > 0 ? <section><h4 className="mb-3 mt-0 text-sm">Utilities</h4><div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">{searchFacets.utilities.map((facet) => <LibraryCollectionCard icon={libraryUtilityIcon(facet.value)} label={facet.label} count={facet.count} key={facet.value} pinned={isPinned("system", facet.value)} onTogglePin={() => void togglePin("system", facet.value)} onClick={() => selectCollection("utility", facet.value)}/>)}</div></section> : null}
          {activeSpace?.role === "owner" && peoplePolicy ? <section><h4 className="mb-3 mt-0 text-sm">Intelligence</h4><div className="flex flex-wrap gap-2"><button className={smallButtonClass} type="button" onClick={() => void toggleIntelligencePolicy("ocr")}>{peoplePolicy.ocr_enabled ? "OCR on" : "OCR off"}</button><button className={smallButtonClass} type="button" onClick={() => void toggleIntelligencePolicy("ai")}>{peoplePolicy.ai_enabled ? "AI metadata on" : "AI metadata off"}</button><button className={smallButtonClass} type="button" onClick={() => void toggleIntelligencePolicy("semantic")}>{peoplePolicy.semantic_search_enabled ? "Semantic search on" : "Semantic search off"}</button></div></section> : null}
          <section><div className="mb-3 flex items-center justify-between"><h4 className="m-0 text-sm">Albums</h4><button className={secondaryButtonClass} type="button" onClick={openCreateAlbum}><Plus size={13}/>New album</button></div><div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">{albums.map((album) => <button className="overflow-hidden rounded-2xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface)] p-0 text-left" type="button" key={album.id} onClick={() => selectCollection("albums", album.id)}><AlbumCover spaceId={spaceId} itemId={album.cover_item_id}/><div className="p-3"><p className="m-0 truncate text-xs font-medium">{album.name}</p><p className="mb-0 mt-1 text-[10px] text-[var(--misty-text-subtle)]">{album.item_count} items</p></div></button>)}</div></section>
          <section><div className="mb-3 flex items-center justify-between"><h4 className="m-0 text-sm">Groups</h4><button className={secondaryButtonClass} type="button" onClick={() => void createGroup()}><Plus size={13}/>New smart group</button></div><div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">{groups.map((group) => <button className="rounded-2xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface)] p-4 text-left" type="button" key={group.id} onClick={() => selectCollection("groups", group.id)}><LibraryIcon size={22}/><p className="mb-0 mt-3 truncate text-xs font-medium">{group.name}</p><p className="mb-0 mt-1 truncate text-[10px] text-[var(--misty-text-subtle)]">{group.rules.all.length} rules</p></button>)}</div></section>
        </div> : null}
        {collection === "albums" && !selectedCollectionId ? <div className="mb-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2">{currentAlbumFolder ? <button className="border-0 bg-transparent p-0 text-xs text-[var(--misty-text-muted)]" type="button" onClick={() => setSelectedAlbumFolderId(currentAlbumFolder.parent_folder_id ?? "")}>←</button> : null}<h4 className="m-0 text-sm">{currentAlbumFolder?.name ?? "Albums"}</h4></div><div className="flex gap-2">{currentAlbumFolder ? <><button className={smallButtonClass} type="button" onClick={() => void renameAlbumFolder()}><Pencil size={12}/>Rename</button><button className={smallButtonClass} type="button" onClick={() => void deleteAlbumFolder()}><Trash2 size={12}/>Delete</button></> : null}<button className={secondaryButtonClass} type="button" onClick={() => void createAlbumFolder()}><Folder size={13}/>New folder</button><button className={secondaryButtonClass} type="button" onClick={openCreateAlbum}><Plus size={13}/>New album</button></div></div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">{visibleAlbumFolders.map((folder) => <button className="rounded-2xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface)] p-4 text-left" type="button" key={folder.id} onClick={() => setSelectedAlbumFolderId(folder.id)}><Folder size={26}/><p className="mb-0 mt-5 truncate text-xs font-medium">{folder.name}</p><p className="mb-0 mt-1 text-[10px] text-[var(--misty-text-subtle)]">{folder.album_count + folder.folder_count} items</p></button>)}{visibleAlbumsForFolder.map((album) => <button className="overflow-hidden rounded-2xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface)] p-0 text-left" type="button" key={album.id} onClick={() => selectCollection("albums", album.id)}><AlbumCover spaceId={spaceId} itemId={album.cover_item_id}/><div className="p-3"><p className="m-0 truncate text-xs font-medium">{album.name}</p><p className="mb-0 mt-1 text-[10px] text-[var(--misty-text-subtle)]">{album.item_count} items</p></div></button>)}</div>
          {visibleAlbumFolders.length === 0 && visibleAlbumsForFolder.length === 0 ? <div className="grid min-h-48 place-items-center text-sm text-[var(--misty-text-subtle)]">Nothing to see here...</div> : null}
        </div> : null}
        {collection === "groups" && !selectedCollectionId ? <div className="mb-5"><div className="mb-3 flex items-center justify-between"><h4 className="m-0 text-sm">Groups</h4><button className={secondaryButtonClass} type="button" onClick={() => void createGroup()}><Plus size={13}/>New smart group</button></div><div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">{groups.map((group) => <button className="rounded-2xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface)] p-4 text-left" type="button" key={group.id} onClick={() => void selectCollection("groups", group.id)}><LibraryIcon size={22}/><p className="mb-0 mt-3 truncate text-xs font-medium">{group.name}</p><p className="mb-0 mt-1 truncate text-[10px] text-[var(--misty-text-subtle)]">{group.rules.all.length} rules</p></button>)}</div></div> : null}
        {collection === "map" && !selectedCollectionId ? <LibraryMapView points={discovery.map_points} onBack={() => selectCollection("collections")} onSelect={(point) => selectCollection("map", point.id)}/> : null}
        {collection === "imports" ? <div className="mb-5"><button className="mb-4 border-0 bg-transparent p-0 text-xs text-[var(--misty-text-muted)]" type="button" onClick={() => selectCollection("collections")}>← Collections</button><div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">{importHistory.map((entry) => <article className="rounded-2xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface)] p-4" key={entry.id}><div className="flex items-center justify-between gap-3"><History size={20}/><span className="rounded-lg bg-[var(--misty-surface-2)] px-2 py-1 text-[10px] capitalize text-[var(--misty-text-muted)]">{entry.direction}</span></div><p className="mb-0 mt-3 truncate text-xs font-medium">{entry.display_name}</p><p className="mb-0 mt-1 truncate text-[10px] text-[var(--misty-text-subtle)]">{entry.direction === "incoming" ? "From" : "To"} {entry.counterpart_space_name}</p><p className="mb-0 mt-3 text-[10px] text-[var(--misty-text-subtle)]">{formatBytes(entry.logical_bytes)} · {formatTime(entry.completed_at ?? entry.created_at)} · {entry.state}</p></article>)}</div>{importHistory.length === 0 ? <div className="grid min-h-48 place-items-center text-sm text-[var(--misty-text-subtle)]">Nothing to see here...</div> : null}</div> : null}
        {collection === "shared" ? <div className="mb-5"><button className="mb-4 border-0 bg-transparent p-0 text-xs text-[var(--misty-text-muted)]" type="button" onClick={() => selectCollection("collections")}>← Collections</button>{sharedReferences.length > 0 ? <section><h4 className="mb-3 mt-0 text-sm">Shared with this Space</h4><div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3">{sharedReferences.map((reference) => <article className="rounded-2xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface)] p-4" key={reference.id}><MessagesSquare size={20}/><p className="mb-0 mt-3 truncate text-xs font-medium">{reference.display_name}</p><p className="mb-3 mt-1 truncate text-[10px] text-[var(--misty-text-subtle)]">From {reference.source_space_name} · {formatBytes(reference.byte_size)}</p><button className={smallButtonClass} type="button" onClick={() => void spacesApi.downloadSharedReference(spaceId, reference.id, reference.display_name)}><Download size={12}/>Download</button></article>)}</div></section> : null}{outgoingReferences.length > 0 ? <section className="mt-7"><h4 className="mb-3 mt-0 text-sm">Shared by this Space</h4><div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3">{outgoingReferences.map((reference) => <article className="rounded-2xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface)] p-4" key={reference.id}><MessagesSquare size={20}/><p className="mb-0 mt-3 truncate text-xs font-medium">{reference.display_name}</p><p className="mb-3 mt-1 truncate text-[10px] text-[var(--misty-text-subtle)]">To {reference.destination_space_name}</p><button className={smallButtonClass} type="button" onClick={() => void revokeSharedReference(reference)}><X size={12}/>Stop sharing</button></article>)}</div></section> : null}{sharedReferences.length === 0 && outgoingReferences.length === 0 ? <div className="grid min-h-48 place-items-center text-sm text-[var(--misty-text-subtle)]">Nothing to see here...</div> : null}</div> : null}
        {collection === "duplicate" && !selectedCollectionId ? <div className="mb-5"><button className="mb-4 border-0 bg-transparent p-0 text-xs text-[var(--misty-text-muted)]" type="button" onClick={() => selectCollection("collections")}>← Collections</button><div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">{discovery.duplicates.map((group, index) => <LibraryDiscoveryCard key={group.id} spaceId={spaceId} group={{ ...group, title: `Duplicates ${index + 1}` }} fallbackIcon={Copy} onClick={() => selectCollection("duplicate", group.id)}/>)}</div></div> : null}
        {collection === "people" && !selectedCollectionId && peoplePolicy ? <div className="mb-5"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h4 className="m-0 text-sm">People & Pets</h4><div className="flex flex-wrap gap-2">{activeSpace?.role === "owner" ? <><button className={smallButtonClass} type="button" onClick={() => void togglePeoplePolicy("person")}>{peoplePolicy.faces_enabled ? "People on" : "People off"}</button><button className={smallButtonClass} type="button" onClick={() => void togglePeoplePolicy("pet")}>{peoplePolicy.pets_enabled ? "Pets on" : "Pets off"}</button></> : null}{peoplePolicy.faces_enabled ? <button className={secondaryButtonClass} type="button" onClick={() => openCreatePerson("person")}><Plus size={13}/>Person</button> : null}{peoplePolicy.pets_enabled ? <button className={secondaryButtonClass} type="button" onClick={() => openCreatePerson("pet")}><Plus size={13}/>Pet</button> : null}</div></div><div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">{people.map((person) => <button className="overflow-hidden rounded-2xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface)] p-0 text-left" type="button" key={person.id} onClick={() => selectCollection("people", person.id)}><AlbumCover spaceId={spaceId} itemId={person.cover_item_id}/><div className="p-3"><p className="m-0 truncate text-xs font-medium">{person.name || (person.kind === "pet" ? "Unnamed pet" : "Unnamed person")}</p><p className="mb-0 mt-1 text-[10px] text-[var(--misty-text-subtle)]">{person.item_count} items · {person.kind === "pet" ? "Pet" : "Person"}</p></div></button>)}</div>{people.length === 0 ? <div className="grid min-h-48 place-items-center text-sm text-[var(--misty-text-subtle)]">Nothing to see here...</div> : null}</div> : null}
        {currentDateGroup ? <div className="mb-4"><button className="border-0 bg-transparent p-0 text-xs text-[var(--misty-text-muted)]" type="button" onClick={() => selectCollection(collection)}>← {collection === "recent-days" ? "Recent Days" : collection === "months" ? "Months" : "Years"}</button><h4 className="mb-0 mt-2 text-sm">{currentDateGroup.title}</h4><p className="mb-0 mt-1 text-xs text-[var(--misty-text-subtle)]">{currentDateGroup.subtitle}</p></div> : null}
        {currentPerson ? <div className="mb-4 flex items-center justify-between gap-3"><div><button className="border-0 bg-transparent p-0 text-xs text-[var(--misty-text-muted)]" type="button" onClick={() => selectCollection("people")}>← People & Pets</button><h4 className="mb-0 mt-2 text-sm">{currentPerson.name || (currentPerson.kind === "pet" ? "Unnamed pet" : "Unnamed person")}</h4></div><div className="flex flex-wrap gap-2"><select className={libraryControlClass} value="" onChange={(event) => { if (event.target.value) void mergeCurrentPerson(event.target.value); }} aria-label="Merge this identity"><option value="">Merge into…</option>{people.filter((person) => person.id !== currentPerson.id && person.kind === currentPerson.kind).map((person) => <option value={person.id} key={person.id}>{person.name || "Unnamed"}</option>)}</select><button className={smallButtonClass} type="button" onClick={openEditPerson}><Pencil size={12}/>Edit</button><button className={smallButtonClass} type="button" onClick={() => void deleteCurrentPerson()}><Trash2 size={12}/>Remove</button></div></div> : currentAlbum ? <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><button className="border-0 bg-transparent p-0 text-xs text-[var(--misty-text-muted)]" type="button" onClick={() => { setSelectedCollectionId(""); setSelectedAlbumFolderId(currentAlbum.folder_id ?? ""); }}>← Albums</button><h4 className="mb-0 mt-2 text-sm">{currentAlbum.name}</h4>{currentAlbum.description ? <p className="mb-0 mt-1 text-xs text-[var(--misty-text-subtle)]">{currentAlbum.description}</p> : null}</div><div className="flex flex-wrap gap-2"><select className={libraryControlClass} value={currentAlbum.folder_id ?? ""} onChange={(event) => void organizeCurrentAlbum({ folder_id: event.target.value })} aria-label="Move album to folder"><option value="">Top level</option>{albumFolders.map((folder) => <option value={folder.id} key={folder.id}>{folder.name}</option>)}</select><select className={libraryControlClass} value={currentAlbum.sort_mode} onChange={(event) => void organizeCurrentAlbum({ sort_mode: event.target.value as LibraryAlbum["sort_mode"] })} aria-label="Sort album"><option value="custom">Custom order</option><option value="oldest">Oldest first</option><option value="newest">Newest first</option></select><button className={smallButtonClass} type="button" onClick={() => void organizeCurrentAlbum({ view_mode: currentAlbum.view_mode === "grid" ? "list" : "grid" })}>{currentAlbum.view_mode === "grid" ? <List size={12}/> : <Grid3X3 size={12}/>} {currentAlbum.view_mode === "grid" ? "List" : "Grid"}</button><button className={smallButtonClass} type="button" onClick={openEditAlbum}><Pencil size={12}/>Edit</button><button className={smallButtonClass} type="button" onClick={() => void deleteCurrentAlbum()}><Trash2 size={12}/>Delete album</button></div></div> : currentMapPoint ? <div className="mb-4"><button className="border-0 bg-transparent p-0 text-xs text-[var(--misty-text-muted)]" type="button" onClick={() => selectCollection("map")}>← Map</button><h4 className="mb-0 mt-2 text-sm">{currentMapPoint.name}</h4><p className="mb-0 mt-1 text-xs text-[var(--misty-text-subtle)]">{currentMapPoint.latitude.toFixed(2)}, {currentMapPoint.longitude.toFixed(2)}</p></div> : currentDiscoveryGroup ? <div className="mb-4 flex items-end justify-between gap-3"><div><button className="border-0 bg-transparent p-0 text-xs text-[var(--misty-text-muted)]" type="button" onClick={() => selectCollection(currentDiscoveryGroup.kind === "duplicate" ? "duplicate" : "collections")}>← {currentDiscoveryGroup.kind === "duplicate" ? "Duplicates" : "Collections"}</button><h4 className="mb-0 mt-2 text-sm">{currentDiscoveryGroup.title}</h4><p className="mb-0 mt-1 text-xs text-[var(--misty-text-subtle)]">{currentDiscoveryGroup.subtitle}</p></div><div className="flex gap-2">{currentDiscoveryGroup.kind === "memory" && visibleItems.length > 0 ? <button className={primaryButtonClass} type="button" onClick={() => setMemoryPlaybackOpen(true)}><Play size={13}/>Play memory</button> : null}{currentDiscoveryGroup.kind === "duplicate" ? <button className={primaryButtonClass} type="button" disabled={bulkSaving || visibleItems.length < 2} onClick={() => void mergeCurrentDuplicates()}>{bulkSaving ? "Merging…" : "Merge"}</button> : null}</div></div> : selectedCollectionId && !currentDateGroup ? <button className="mb-4 border-0 bg-transparent p-0 text-xs text-[var(--misty-text-muted)]" type="button" onClick={() => selectCollection("collections")}>← Collections</button> : null}
        {currentDiscoveryGroup?.kind === "memory" ? <div className="mb-4 flex flex-wrap gap-2"><button className={smallButtonClass} type="button" onClick={() => { const title = window.prompt("Memory title", currentDiscoveryGroup.title)?.trim(); if (title && title !== currentDiscoveryGroup.title) void updateCurrentMemory({ title }); }}><Pencil size={12}/>Rename</button><select className={libraryControlClass} value={currentDiscoveryGroup.cover_item_id ?? ""} onChange={(event) => void updateCurrentMemory({ cover_item_id: event.target.value })} aria-label="Choose memory key photo">{visibleItems.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.display_name}</option>)}</select><select className={libraryControlClass} value={currentDiscoveryGroup.music_item_id ?? ""} onChange={(event) => void updateCurrentMemory({ music_item_id: event.target.value })} aria-label="Choose memory music"><option value="">No music</option>{memoryAudioItems.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.display_name}</option>)}</select><select className={libraryControlClass} value={currentDiscoveryGroup.playback_seconds ?? 4.5} onChange={(event) => void updateCurrentMemory({ playback_seconds: Number(event.target.value) })} aria-label="Choose memory pace"><option value={2}>Fast</option><option value={4.5}>Medium</option><option value={7}>Slow</option></select></div> : null}
        {loading ? <div className="grid min-h-64 place-items-center text-sm text-[var(--misty-text-subtle)]">Loading Library…</div> : collection === "collections" || collection === "shared" || collection === "imports" || (collection === "recent-days" || collection === "months" || collection === "years" || collection === "people" || collection === "albums" || collection === "groups" || collection === "duplicate" || collection === "map") && !selectedCollectionId ? null : visibleItems.length === 0 ? (
          <div className="grid min-h-64 place-items-center text-sm text-[var(--misty-text-subtle)]">Nothing to see here...</div>
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: currentAlbum?.view_mode === "list" ? "1fr" : `repeat(auto-fill,minmax(${gridSize}px,1fr))` }}>
            {visibleItems.map((item, itemIndex) => {
              const dateGroup = libraryDateGroupLabel(item, sort);
              const previousDateGroup = itemIndex > 0 ? libraryDateGroupLabel(visibleItems[itemIndex - 1], sort) : "";
              return <Fragment key={item.id}>
              {dateGroup && dateGroup !== previousDateGroup ? <h4 className="col-span-full mb-0 mt-3 text-xs font-semibold text-[var(--misty-text-muted)] first:mt-0">{dateGroup}</h4> : null}
              <article className={`group min-w-0 rounded-2xl border bg-[var(--misty-surface)] p-3 ${currentAlbum?.view_mode === "list" ? "grid grid-cols-[112px_minmax(0,1fr)] items-center gap-3" : ""} ${selectedItemIds.includes(item.id) ? "border-[var(--misty-primary)]" : "border-[var(--misty-border-soft)]"}`} draggable={canReorderAlbum && !selecting} onDragStart={() => setDraggedAlbumItemId(item.id)} onDragEnd={() => setDraggedAlbumItemId("")} onDragOver={(event) => { if (canReorderAlbum) event.preventDefault(); }} onDrop={(event) => { event.preventDefault(); void reorderAlbumItem(item.id); }}>
              <button className={`relative grid ${squareGrid ? "aspect-square" : "aspect-[4/3]"} w-full place-items-center overflow-hidden rounded-xl border-0 bg-[var(--misty-surface-2)] text-[var(--misty-text-subtle)]`} type="button" onClick={() => selecting ? toggleSelectedItem(item.id) : setSelectedItemId(item.id)} aria-label={selecting ? `${selectedItemIds.includes(item.id) ? "Deselect" : "Select"} ${item.display_name}` : `Open ${item.display_name}`}><LibraryItemThumbnail spaceId={spaceId} item={item}/>{selecting ? <span className={`absolute right-2 top-2 grid size-5 place-items-center rounded-full border ${selectedItemIds.includes(item.id) ? "border-[var(--misty-primary)] bg-[var(--misty-primary)] text-[var(--misty-primary-contrast)]" : "border-white/60 bg-black/40 text-transparent"}`}><Check size={12}/></span> : null}</button>
              <div className="mt-3 flex min-w-0 items-start gap-2"><div className="min-w-0 flex-1"><p className="m-0 truncate text-xs font-medium" title={item.display_name}>{item.display_name}</p><p className="m-0 mt-1 text-[10px] text-[var(--misty-text-subtle)]">{formatBytes(Number(item.file.intrinsic_metadata.byte_size ?? 0))} · {formatTime(item.added_at)}</p></div>{!selecting ? <button className={`${rowActionClass} !visible`} type="button" onClick={() => void updateItem(item, { favorite: !item.favorite })} title={item.favorite ? "Remove favorite" : "Favorite"}><Star size={14} fill={item.favorite ? "currentColor" : "none"}/></button> : null}</div>
              {!selecting ? collection === "deleted" ? <div className="mt-2 flex flex-wrap gap-1"><button className={smallButtonClass} type="button" onClick={() => void restoreItem(item)}>Restore</button></div> : <div className="mt-2 flex flex-wrap gap-1"><button className={smallButtonClass} type="button" onClick={() => void spacesApi.downloadLibraryItem(spaceId, item.id, item.display_name)}><Download size={12}/>Download</button><button className={smallButtonClass} type="button" onClick={() => { const name = window.prompt("Rename in this Space", item.display_name)?.trim(); if (name && name !== item.display_name) void updateItem(item, { display_name: name }); }}><Pencil size={12}/>Rename</button><button className={smallButtonClass} type="button" onClick={() => { const tags = window.prompt("Tags, separated by commas", item.tags.join(", ")); if (tags !== null) void updateItem(item, { tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean) }); }}>Tags</button><button className={smallButtonClass} type="button" title="Move to Recently Deleted" onClick={() => void trashItem(item)}><Trash2 size={12}/></button></div> : null}
              {!selecting && albums.length > 0 ? <select className="mt-2 w-full rounded-lg border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] px-2 py-1 text-[10px] text-[var(--misty-text-muted)]" value="" onChange={(event) => { const albumId = event.target.value; if (albumId) void spacesApi.addAlbumItems(spaceId, albumId, [item.id]).then(() => spacesApi.albums(spaceId)).then((result) => setAlbums(result.albums)); }} aria-label={`Add ${item.display_name} to album`}><option value="">Add to album…</option>{albums.map((album) => <option value={album.id} key={album.id}>{album.name}</option>)}</select> : null}
              </article>
              </Fragment>;
            })}
            {nextAfter ? <div className="col-span-full grid place-items-center pt-3"><button className={secondaryButtonClass} type="button" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "Loading…" : "Load more"}</button></div> : null}
          </div>
        )}
      </div>
      {selectedItemId ? <LibraryItemViewer spaceId={spaceId} item={visibleItems.find((item) => item.id === selectedItemId) ?? items.find((item) => item.id === selectedItemId) ?? null} items={visibleItems} onClose={() => setSelectedItemId("")} onSelect={setSelectedItemId} onUpdate={updateItem} onReplaceItem={replaceItem} onRenditionReady={() => setReloadKey((current) => current + 1)} onTrash={trashItem}/> : null}
      {memoryPlaybackOpen && currentDiscoveryGroup?.kind === "memory" ? <LibraryMemoryPlayback spaceId={spaceId} group={currentDiscoveryGroup} items={visibleItems} onClose={() => setMemoryPlaybackOpen(false)}/> : null}
      {albumDialogMode ? <div className="fixed inset-0 z-[2147483000] grid place-items-center bg-black/60 p-6" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !albumSaving) setAlbumDialogMode(""); }}><form className="w-full max-w-sm rounded-2xl border border-[var(--misty-border-strong)] bg-[var(--misty-modal-bg,var(--misty-surface))] p-5 shadow-2xl" onSubmit={(event) => void saveAlbum(event)}><div className="flex items-center justify-between gap-4"><h2 className="m-0 text-base font-semibold">{albumDialogMode === "create" ? "New album" : "Edit album"}</h2><button className={iconButtonClass} type="button" disabled={albumSaving} onClick={() => setAlbumDialogMode("")} aria-label="Close album dialog"><X size={15}/></button></div><label className="mt-5 grid gap-2 text-xs font-medium text-[var(--misty-text-muted)]">Name<input className={inputClass} autoFocus maxLength={120} value={albumName} onChange={(event) => setAlbumName(event.target.value)}/></label><label className="mt-4 grid gap-2 text-xs font-medium text-[var(--misty-text-muted)]">Description<textarea className={`${inputClass} min-h-20 resize-y py-2`} maxLength={2000} value={albumDescription} onChange={(event) => setAlbumDescription(event.target.value)}/></label>{albumDialogMode === "edit" && visibleItems.length > 0 ? <label className="mt-4 grid gap-2 text-xs font-medium text-[var(--misty-text-muted)]">Cover<select className={inputClass} value={albumCoverItemId} onChange={(event) => setAlbumCoverItemId(event.target.value)}><option value="">Automatic</option>{visibleItems.map((item) => <option value={item.id} key={item.id}>{item.display_name}</option>)}</select></label> : null}<div className="mt-5 flex justify-end gap-2"><button className={secondaryButtonClass} type="button" disabled={albumSaving} onClick={() => setAlbumDialogMode("")}>Cancel</button><button className={primaryButtonClass} type="submit" disabled={albumSaving || !albumName.trim()}>{albumSaving ? "Saving…" : albumDialogMode === "create" ? "Create" : "Save"}</button></div></form></div> : null}
      {personDialogMode ? <div className="fixed inset-0 z-[2147483000] grid place-items-center bg-black/60 p-6" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !personSaving) setPersonDialogMode(""); }}><form className="w-full max-w-sm rounded-2xl border border-[var(--misty-border-strong)] bg-[var(--misty-modal-bg,var(--misty-surface))] p-5 shadow-2xl" onSubmit={(event) => void savePerson(event)}><div className="flex items-center justify-between gap-4"><h2 className="m-0 text-base font-semibold">{personDialogMode === "create" ? personKind === "pet" ? "New pet" : "New person" : personKind === "pet" ? "Edit pet" : "Edit person"}</h2><button className={iconButtonClass} type="button" disabled={personSaving} onClick={() => setPersonDialogMode("")} aria-label="Close People & Pets dialog"><X size={15}/></button></div><label className="mt-5 grid gap-2 text-xs font-medium text-[var(--misty-text-muted)]">Name<input className={inputClass} autoFocus maxLength={120} value={personName} onChange={(event) => setPersonName(event.target.value)}/></label>{personDialogMode === "edit" && visibleItems.length > 0 ? <label className="mt-4 grid gap-2 text-xs font-medium text-[var(--misty-text-muted)]">Cover<select className={inputClass} value={personCoverItemId} onChange={(event) => setPersonCoverItemId(event.target.value)}><option value="">Automatic</option>{visibleItems.map((item) => <option value={item.id} key={item.id}>{item.display_name}</option>)}</select></label> : null}<div className="mt-5 flex justify-end gap-2"><button className={secondaryButtonClass} type="button" disabled={personSaving} onClick={() => setPersonDialogMode("")}>Cancel</button><button className={primaryButtonClass} type="submit" disabled={personSaving}>{personSaving ? "Saving…" : personDialogMode === "create" ? "Create" : "Save"}</button></div></form></div> : null}
      {metadataDialogAction ? <div className="fixed inset-0 z-[2147483000] grid place-items-center bg-black/60 p-6" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !bulkSaving) setMetadataDialogAction(""); }}><form className="w-full max-w-sm rounded-2xl border border-[var(--misty-border-strong)] bg-[var(--misty-modal-bg,var(--misty-surface))] p-5 shadow-2xl" onSubmit={(event) => void saveBulkMetadata(event)}><div className="flex items-center justify-between gap-4"><h2 className="m-0 text-base font-semibold">{metadataDialogAction === "add_tags" ? "Add tags" : metadataDialogAction === "remove_tags" ? "Remove tags" : metadataDialogAction === "set_date" ? "Adjust date" : "Set location"}</h2><button className={iconButtonClass} type="button" disabled={bulkSaving} onClick={() => setMetadataDialogAction("")} aria-label="Close metadata dialog"><X size={15}/></button></div><p className="mb-0 mt-1 text-xs text-[var(--misty-text-subtle)]">{selectedItems.length} selected item{selectedItems.length === 1 ? "" : "s"}</p>{metadataDialogAction === "add_tags" || metadataDialogAction === "remove_tags" ? <label className="mt-5 grid gap-2 text-xs font-medium text-[var(--misty-text-muted)]">Tags<input className={inputClass} autoFocus value={metadataTags} onChange={(event) => setMetadataTags(event.target.value)} placeholder="travel, family"/></label> : metadataDialogAction === "set_date" ? <label className="mt-5 grid gap-2 text-xs font-medium text-[var(--misty-text-muted)]">Date and time<input className={inputClass} autoFocus type="datetime-local" value={metadataDate} onChange={(event) => setMetadataDate(event.target.value)}/></label> : <div className="mt-5 grid gap-4"><label className="grid gap-2 text-xs font-medium text-[var(--misty-text-muted)]">Place name<input className={inputClass} autoFocus value={metadataLocationName} onChange={(event) => setMetadataLocationName(event.target.value)} placeholder="Big Sur"/></label><div className="grid grid-cols-2 gap-3"><label className="grid gap-2 text-xs font-medium text-[var(--misty-text-muted)]">Latitude<input className={inputClass} inputMode="decimal" value={metadataLatitude} onChange={(event) => setMetadataLatitude(event.target.value)} placeholder="36.2704"/></label><label className="grid gap-2 text-xs font-medium text-[var(--misty-text-muted)]">Longitude<input className={inputClass} inputMode="decimal" value={metadataLongitude} onChange={(event) => setMetadataLongitude(event.target.value)} placeholder="-121.8079"/></label></div></div>}<div className="mt-5 flex justify-end gap-2"><button className={secondaryButtonClass} type="button" disabled={bulkSaving} onClick={() => setMetadataDialogAction("")}>Cancel</button><button className={primaryButtonClass} type="submit" disabled={bulkSaving}>{bulkSaving ? "Saving…" : "Apply"}</button></div></form></div> : null}
    </div>
  );
}

function LibraryMemoryPlayback({ spaceId, group, items, onClose }: { spaceId: string; group: LibraryDiscoveryGroup; items: SpaceLibraryItem[]; onClose: () => void }) {
  const musicRef = useRef<HTMLAudioElement | null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [contentUrl, setContentUrl] = useState("");
  const [musicUrl, setMusicUrl] = useState("");
  const [contentError, setContentError] = useState("");
  const item = items[index] ?? null;
  const mimeType = String(item?.file.intrinsic_metadata.server_detected_mime_type ?? item?.file.intrinsic_metadata.client_declared_mime_type ?? "").split(";")[0].toLowerCase();
  const isVideo = mimeType.startsWith("video/");
  const isVisualImage = mimeType.startsWith("image/") || !isVideo && Number(item?.file.intrinsic_metadata.width ?? 0) > 0;

  useEffect(() => {
    let current = true;
    let objectUrl = "";
    setContentUrl("");
    setContentError("");
    if (!item) return () => { current = false; };
    const request = isVisualImage ? spacesApi.libraryPreview(spaceId, item.id) : spacesApi.libraryContent(spaceId, item.id);
    void request.then((blob) => {
      if (!current) return;
      objectUrl = URL.createObjectURL(blob);
      setContentUrl(objectUrl);
    }).catch(() => current && setContentError("This item could not be played."));
    return () => {
      current = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [isVisualImage, item?.id, spaceId]);

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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowLeft") setIndex((current) => (current - 1 + items.length) % items.length);
      else if (event.key === "ArrowRight") setIndex((current) => (current + 1) % items.length);
      else if (event.key === " ") {
        event.preventDefault();
        setPlaying((current) => !current);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [items.length, onClose]);

  if (!item) return null;
  const previous = () => setIndex((current) => (current - 1 + items.length) % items.length);
  const next = () => setIndex((current) => (current + 1) % items.length);
  return <div className="fixed inset-0 z-[2147483100] flex flex-col bg-black text-white" role="dialog" aria-modal="true" aria-label={`Playing ${group.title}`}>
    <div className="flex items-center gap-1 px-5 pt-4">{items.map((candidate, candidateIndex) => <button className="h-1 flex-1 overflow-hidden rounded-full border-0 bg-white/20 p-0" type="button" key={candidate.id} onClick={() => setIndex(candidateIndex)} aria-label={`Show item ${candidateIndex + 1}`}><span className={`block h-full bg-white transition-[width] duration-300 ${candidateIndex < index ? "w-full" : candidateIndex === index ? "w-1/2" : "w-0"}`}/></button>)}</div>
    <header className="flex items-center justify-between gap-4 px-5 py-4"><div className="min-w-0"><h2 className="m-0 truncate text-base font-semibold">{group.title}</h2><p className="mb-0 mt-1 truncate text-xs text-white/55">{group.subtitle}</p></div><button className="grid size-9 shrink-0 place-items-center rounded-full border-0 bg-white/10 text-white hover:bg-white/20" type="button" onClick={onClose} aria-label="Close memory"><X size={18}/></button></header>
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
  onClose: () => void;
  onSelect: (itemId: string) => void;
  onUpdate: (item: SpaceLibraryItem, patch: Partial<Pick<SpaceLibraryItem, "display_name" | "caption" | "favorite" | "hidden" | "tags">>) => Promise<SpaceLibraryItem | null>;
  onReplaceItem: (item: SpaceLibraryItem) => void;
  onRenditionReady: () => void;
  onTrash: (item: SpaceLibraryItem) => Promise<boolean>;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [contentUrl, setContentUrl] = useState("");
  const [contentError, setContentError] = useState("");
  const [contentLoading, setContentLoading] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [caption, setCaption] = useState("");
  const [tags, setTags] = useState("");
  const [saving, setSaving] = useState(false);
  const [editVersions, setEditVersions] = useState<LibraryEditVersion[]>([]);
  const [editingAvailable, setEditingAvailable] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState<LibraryEditDefinition>(() => defaultLibraryEdit());
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const index = item ? items.findIndex((candidate) => candidate.id === item.id) : -1;
  const metadata = item?.file.intrinsic_metadata ?? {};
  const mimeType = String(metadata.server_detected_mime_type ?? metadata.client_declared_mime_type ?? "application/octet-stream").split(";")[0].toLowerCase();
  const isImage = mimeType.startsWith("image/") || !mimeType.startsWith("video/") && Number(metadata.width ?? 0) > 0 && Number(metadata.height ?? 0) > 0;
  const isVideo = /^video\//.test(mimeType);
  const isAudio = /^audio\//.test(mimeType);
  const activeEdit = editVersions.find((version) => version.is_current) ?? null;
  const appliedEdit = editing ? editDraft : activeEdit?.edit_definition ?? defaultLibraryEdit();
  const renditionReady = activeEdit?.rendition_state === "ready";
  const mediaStyle = renditionReady && !editing ? undefined : libraryEditStyle(appliedEdit);

  useEffect(() => {
    if (!item) return;
    setDisplayName(item.display_name);
    setCaption(item.caption);
    setTags(item.tags.join(", "));
  }, [item?.id, item?.version]);

  useEffect(() => {
    if (!item || !isImage && !isVideo) {
      setEditVersions([]);
      setEditingAvailable(false);
      return;
    }
    let current = true;
    void spacesApi.editVersions(spaceId, item.id).then((result) => {
      if (!current) return;
      setEditVersions(result.versions);
      setEditingAvailable(true);
      const selected = result.versions.find((version) => version.is_current);
      setEditDraft(selected?.edit_definition ?? defaultLibraryEdit());
    }).catch(() => {
      if (!current) return;
      setEditVersions([]);
      setEditingAvailable(false);
    });
    return () => { current = false; };
  }, [isImage, isVideo, item?.id, item?.version, spaceId]);

  useEffect(() => {
    if (!item || !editVersions.some((version) => version.rendition_state === "queued" || version.rendition_state === "processing")) return;
    let current = true;
    const refresh = () => void spacesApi.editVersions(spaceId, item.id).then((result) => {
      if (!current) return;
      const newlyReady = result.versions.some((version) => version.rendition_state === "ready" && editVersions.some((previous) => previous.id === version.id && previous.rendition_state !== "ready"));
      setEditVersions(result.versions);
      if (newlyReady) onRenditionReady();
    }).catch(() => undefined);
    const timer = window.setInterval(refresh, 1500);
    return () => { current = false; window.clearInterval(timer); };
  }, [editVersions, item?.id, onRenditionReady, spaceId]);

  useEffect(() => {
    if (!item || !isImage && !isVideo && !isAudio) {
      setContentUrl("");
      setContentError("");
      return;
    }
    let current = true;
    let objectUrl = "";
    setContentLoading(true);
    setContentError("");
    const request = editing
      ? isImage ? spacesApi.libraryOriginalPreview(spaceId, item.id) : spacesApi.libraryOriginalContent(spaceId, item.id)
      : isImage ? spacesApi.libraryPreview(spaceId, item.id) : spacesApi.libraryContent(spaceId, item.id);
    void request.then((blob) => {
      if (!current) return;
      objectUrl = URL.createObjectURL(blob);
      setContentUrl(objectUrl);
    }).catch((error: unknown) => current && setContentError(error instanceof Error ? error.message : "Preview unavailable.")).finally(() => current && setContentLoading(false));
    return () => {
      current = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [activeEdit?.rendition_state, editing, isAudio, isImage, isVideo, item?.id, spaceId]);

  useEffect(() => {
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
  }, [index, items, onClose, onSelect]);

  if (!item) return null;

  const saveMetadata = async (event: FormEvent) => {
    event.preventDefault();
    const name = displayName.trim();
    if (!name || saving) return;
    setSaving(true);
    try {
      await onUpdate(item, { display_name: name, caption: caption.trim(), tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean) });
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async () => {
    if (editSaving) return;
    setEditSaving(true);
    setEditError("");
    try {
      const result = await spacesApi.createEditVersion(spaceId, item, editDraft);
      onReplaceItem(result.item);
      if (result.edit) {
        let savedVersion = { ...result.edit, is_current: true };
        setEditVersions((current) => [savedVersion, ...current.map((version) => ({ ...version, is_current: false }))]);
        try {
          const rendition = await spacesApi.renderEditVersion(spaceId, item.id, result.edit.id);
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

  const renderEdit = async (editID: string) => {
    if (editSaving) return;
    setEditSaving(true);
    setEditError("");
    try {
      const rendition = await spacesApi.renderEditVersion(spaceId, item.id, editID);
      setEditVersions((current) => current.map((version) => version.id === editID ? { ...version, rendition_state: rendition.state, rendition_error_code: undefined } : version));
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "The edit rendition could not start.");
    } finally {
      setEditSaving(false);
    }
  };

  const selectEdit = async (editID = "") => {
    if (editSaving) return;
    setEditSaving(true);
    setEditError("");
    try {
      const result = await spacesApi.selectEditVersion(spaceId, item, editID);
      onReplaceItem(result.item);
      setEditVersions((current) => current.map((version) => ({ ...version, is_current: version.id === editID })));
      const selected = editVersions.find((version) => version.id === editID);
      setEditDraft(selected?.edit_definition ?? defaultLibraryEdit());
      setEditing(false);
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "Version could not be selected.");
    } finally {
      setEditSaving(false);
    }
  };

  const deleteEdit = async (editID: string) => {
    if (editSaving || !window.confirm("Delete this edit version?")) return;
    setEditSaving(true);
    try {
      await spacesApi.deleteEditVersion(spaceId, item.id, editID);
      setEditVersions((current) => current.filter((version) => version.id !== editID));
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "Version could not be deleted.");
    } finally {
      setEditSaving(false);
    }
  };

  const beginEditing = () => {
    setEditDraft(activeEdit?.edit_definition ?? defaultLibraryEdit());
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

  return (
    <div className="fixed inset-0 z-[2147483100] grid place-items-center bg-black/80 p-4 backdrop-blur-sm" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <section className="grid h-[min(860px,calc(100vh-32px))] w-[min(1320px,calc(100vw-32px))] grid-cols-[minmax(0,1fr)_340px] grid-rows-[56px_minmax(0,1fr)] overflow-hidden rounded-2xl border border-[var(--misty-border-strong)] bg-[var(--misty-app-page-bg,#07090b)] shadow-2xl" role="dialog" aria-modal="true" aria-label={item.display_name}>
        <header className="col-span-2 flex items-center justify-between border-b border-[var(--misty-border-soft)] px-4">
          <div className="min-w-0"><p className="m-0 truncate text-sm font-medium">{item.display_name}</p><p className="m-0 mt-0.5 text-[10px] text-[var(--misty-text-subtle)]">{index + 1} of {items.length}</p></div>
          <div className="flex items-center gap-1">
            <button className={iconButtonClass} type="button" onClick={() => void onUpdate(item, { favorite: !item.favorite })} aria-label={item.favorite ? "Remove favorite" : "Favorite"} title={item.favorite ? "Remove favorite" : "Favorite"}><Star size={15} fill={item.favorite ? "currentColor" : "none"}/></button>
            <button className={iconButtonClass} type="button" onClick={() => void onUpdate(item, { hidden: !item.hidden })} aria-label={item.hidden ? "Unhide" : "Hide"} title={item.hidden ? "Unhide" : "Hide"}><EyeOff size={15}/></button>
            {editingAvailable ? <button className={iconButtonClass} type="button" onClick={beginEditing} aria-label="Edit" title="Edit"><SlidersHorizontal size={15}/></button> : null}
            {activeEdit ? <button className={iconButtonClass} type="button" onClick={() => void spacesApi.downloadOriginalLibraryItem(spaceId, item.id, item.file.original_filename)} aria-label="Download original" title="Download original"><File size={15}/></button> : null}
            <button className={iconButtonClass} type="button" disabled={Boolean(activeEdit) && !renditionReady} onClick={() => void spacesApi.downloadLibraryItem(spaceId, item.id, item.display_name)} aria-label={activeEdit ? renditionReady ? "Download edited media" : "Edited media is rendering" : "Download"} title={activeEdit ? renditionReady ? "Download edited media" : "Edited media is rendering" : "Download"}><Download size={15}/></button>
            <button className={iconButtonClass} type="button" onClick={() => void onTrash(item)} aria-label="Move to Recently Deleted" title="Move to Recently Deleted"><Trash2 size={15}/></button>
            <button className={iconButtonClass} type="button" onClick={onClose} aria-label="Close"><X size={15}/></button>
          </div>
        </header>
        <div className="relative grid min-h-0 place-items-center overflow-hidden bg-black/35 p-6">
          {contentLoading ? <span className="text-xs text-white/50">Loading…</span> : contentError ? <span className="max-w-sm text-center text-xs text-red-200">{contentError}</span> : isImage && contentUrl ? <img className="max-h-full max-w-full object-contain transition-[filter,transform]" style={mediaStyle} src={contentUrl} alt={item.display_name}/> : isVideo && contentUrl ? <video ref={videoRef} className="max-h-full max-w-full transition-[filter,transform]" style={mediaStyle} src={contentUrl} controls autoPlay={false} onLoadedMetadata={handleVideoTime} onTimeUpdate={handleVideoTime}/> : isAudio && contentUrl ? <div className="grid gap-5 text-center"><File className="mx-auto text-white/60" size={64}/><audio src={contentUrl} controls/></div> : <div className="grid gap-3 text-center text-white/50"><File className="mx-auto" size={64}/><span className="text-sm">Preview unavailable</span><button className={secondaryButtonClass} type="button" onClick={() => void spacesApi.downloadLibraryItem(spaceId, item.id, item.display_name)}><Download size={14}/>Download</button></div>}
          <button className="absolute left-4 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full border border-white/10 bg-black/45 text-white disabled:opacity-20" type="button" disabled={index <= 0} onClick={() => index > 0 && onSelect(items[index - 1].id)} aria-label="Previous item"><ChevronLeft size={20}/></button>
          <button className="absolute right-4 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full border border-white/10 bg-black/45 text-white disabled:opacity-20" type="button" disabled={index < 0 || index >= items.length - 1} onClick={() => index >= 0 && index < items.length - 1 && onSelect(items[index + 1].id)} aria-label="Next item"><ChevronRight size={20}/></button>
        </div>
        <aside className="min-h-0 overflow-auto border-l border-[var(--misty-border-soft)] bg-[var(--misty-surface)] p-5">
          {editing ? <section className="mb-6 border-b border-[var(--misty-border-soft)] pb-5"><div className="flex items-center justify-between"><h3 className="m-0 text-sm">Edit</h3><button className={smallButtonClass} type="button" onClick={() => setEditDraft(defaultLibraryEdit())}>Reset</button></div><div className="mt-4 flex flex-wrap gap-2"><button className={smallButtonClass} type="button" onClick={() => setEditDraft((current) => ({ ...current, rotation: ((current.rotation + 90) % 360) as LibraryEditDefinition["rotation"] }))}><RotateCw size={12}/>Rotate</button><button className={smallButtonClass} type="button" onClick={() => setEditDraft((current) => ({ ...current, flip_horizontal: !current.flip_horizontal }))}>Flip H</button><button className={smallButtonClass} type="button" onClick={() => setEditDraft((current) => ({ ...current, flip_vertical: !current.flip_vertical }))}>Flip V</button><button className={smallButtonClass} type="button" onClick={() => setEditDraft((current) => ({ ...current, auto_enhance: !current.auto_enhance }))}>{editDraft.auto_enhance ? "Auto on" : "Auto"}</button></div><label className="mt-4 grid gap-1.5 text-[10px] font-medium uppercase tracking-wide text-[var(--misty-text-subtle)]">Filter<select className={inputClass} value={editDraft.filter} onChange={(event) => setEditDraft((current) => ({ ...current, filter: event.target.value as LibraryEditDefinition["filter"] }))}><option value="">None</option><option value="vivid">Vivid</option><option value="dramatic">Dramatic</option><option value="warm">Warm</option><option value="cool">Cool</option><option value="mono">Mono</option><option value="noir">Noir</option></select></label><LibraryEditRange label="Brightness" value={editDraft.brightness} min={0} max={2} step={0.05} onChange={(value) => setEditDraft((current) => ({ ...current, brightness: value }))}/><LibraryEditRange label="Contrast" value={editDraft.contrast} min={0} max={2} step={0.05} onChange={(value) => setEditDraft((current) => ({ ...current, contrast: value }))}/><LibraryEditRange label="Saturation" value={editDraft.saturation} min={0} max={2} step={0.05} onChange={(value) => setEditDraft((current) => ({ ...current, saturation: value }))}/><LibraryEditRange label="Grayscale" value={editDraft.grayscale} min={0} max={1} step={0.05} onChange={(value) => setEditDraft((current) => ({ ...current, grayscale: value }))}/>{isImage ? <div className="mt-4"><p className="m-0 text-[10px] font-medium uppercase tracking-wide text-[var(--misty-text-subtle)]">Crop</p><div className="mt-2 flex gap-1"><button className={smallButtonClass} type="button" onClick={() => setEditDraft((current) => ({ ...current, crop: undefined }))}>Original</button><button className={smallButtonClass} type="button" onClick={() => setEditDraft((current) => ({ ...current, crop: { x: 0.125, y: 0, width: 0.75, height: 1 } }))}>Square</button><button className={smallButtonClass} type="button" onClick={() => setEditDraft((current) => ({ ...current, crop: { x: 0, y: 0.125, width: 1, height: 0.75 } }))}>Wide</button></div></div> : null}{isVideo ? <div className="mt-4 grid grid-cols-2 gap-2"><label className="grid gap-1 text-[10px] uppercase text-[var(--misty-text-subtle)]">Trim start<input className={inputClass} type="number" min={0} step={0.1} value={editDraft.trim?.start ?? 0} onChange={(event) => setEditDraft((current) => ({ ...current, trim: { start: Number(event.target.value), end: current.trim?.end ?? Math.max(1, Number(metadata.duration ?? 1)) } }))}/></label><label className="grid gap-1 text-[10px] uppercase text-[var(--misty-text-subtle)]">Trim end<input className={inputClass} type="number" min={0.1} step={0.1} value={editDraft.trim?.end ?? Number(metadata.duration ?? 1)} onChange={(event) => setEditDraft((current) => ({ ...current, trim: { start: current.trim?.start ?? 0, end: Number(event.target.value) } }))}/></label><label className="grid gap-1 text-[10px] uppercase text-[var(--misty-text-subtle)]">Speed<select className={inputClass} value={editDraft.playback_speed} onChange={(event) => setEditDraft((current) => ({ ...current, playback_speed: Number(event.target.value) }))}><option value={0.5}>0.5×</option><option value={1}>1×</option><option value={1.5}>1.5×</option><option value={2}>2×</option></select></label><button className={`${smallButtonClass} self-end`} type="button" onClick={() => setEditDraft((current) => ({ ...current, mute: !current.mute }))}>{editDraft.mute ? "Muted" : "Mute"}</button></div> : null}{editError ? <p className="mb-0 mt-3 text-xs text-red-200">{editError}</p> : null}<div className="mt-4 flex gap-2"><button className={`${secondaryButtonClass} flex-1 justify-center`} type="button" disabled={editSaving} onClick={() => { setEditing(false); setEditDraft(activeEdit?.edit_definition ?? defaultLibraryEdit()); }}>Cancel</button><button className={`${primaryButtonClass} flex-1 justify-center`} type="button" disabled={editSaving} onClick={() => void saveEdit()}>{editSaving ? "Saving…" : "Save edit"}</button></div></section> : null}
          <form onSubmit={(event) => void saveMetadata(event)}>
            <label className="grid gap-1.5 text-[10px] font-medium uppercase tracking-wide text-[var(--misty-text-subtle)]">Name<input className={inputClass} value={displayName} maxLength={255} onChange={(event) => setDisplayName(event.target.value)}/></label>
            <label className="mt-4 grid gap-1.5 text-[10px] font-medium uppercase tracking-wide text-[var(--misty-text-subtle)]">Caption<textarea className={`${inputClass} min-h-24 resize-y py-2`} value={caption} maxLength={4000} onChange={(event) => setCaption(event.target.value)}/></label>
            <label className="mt-4 grid gap-1.5 text-[10px] font-medium uppercase tracking-wide text-[var(--misty-text-subtle)]">Tags<input className={inputClass} value={tags} placeholder="project, receipt, reference" onChange={(event) => setTags(event.target.value)}/></label>
            <button className={`${primaryButtonClass} mt-4 w-full justify-center`} type="submit" disabled={saving || !displayName.trim()}>{saving ? "Saving…" : "Save metadata"}</button>
          </form>
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
            <div className="flex items-center justify-between"><h3 className="m-0 text-sm">Versions</h3><button className={`${smallButtonClass} ${!activeEdit ? "text-[var(--misty-text)]" : ""}`} type="button" disabled={editSaving || !activeEdit} onClick={() => void selectEdit()}>Original</button></div>
            {editError && !editing ? <p className="mb-0 mt-3 text-xs text-red-200">{editError}</p> : null}
            <div className="mt-3 grid gap-2">{editVersions.map((version) => <div className={`flex items-center gap-2 rounded-lg border px-2 py-2 ${version.is_current ? "border-[var(--misty-primary)]" : "border-[var(--misty-border-soft)]"}`} key={version.id}>
              <button className="min-w-0 flex-1 border-0 bg-transparent p-0 text-left" type="button" disabled={editSaving || version.is_current} onClick={() => void selectEdit(version.id)}><span className="block text-xs font-medium">Edit {version.version_number}</span><span className="mt-0.5 block text-[10px] text-[var(--misty-text-subtle)]">{libraryRenditionStatus(version)} · {formatTime(version.created_at)}</span></button>
              {version.rendition_state === "none" || version.rendition_state === "failed" ? <button className={smallButtonClass} type="button" disabled={editSaving} onClick={() => void renderEdit(version.id)}>Render</button> : null}
              {!version.is_current ? <button className="grid size-6 place-items-center border-0 bg-transparent text-[var(--misty-text-subtle)]" type="button" disabled={editSaving} onClick={() => void deleteEdit(version.id)} aria-label={`Delete edit ${version.version_number}`}><Trash2 size={12}/></button> : null}
            </div>)}</div>
          </section> : null}
        </aside>
      </section>
    </div>
  );
}

function LibraryMetadataRow({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-[10px] uppercase tracking-wide text-[var(--misty-text-subtle)]">{label}</dt><dd className="m-0 mt-1 break-words text-[var(--misty-text-muted)]">{value || "—"}</dd></div>;
}

function LibraryEditRange({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void }) {
  return <label className="mt-4 grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 text-[10px] font-medium uppercase tracking-wide text-[var(--misty-text-subtle)]"><span>{label}</span><span>{value.toFixed(2)}</span><input className="col-span-2 w-full accent-[var(--misty-primary)]" type="range" value={value} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))}/></label>;
}

function defaultLibraryEdit(): LibraryEditDefinition {
  return { rotation: 0, flip_horizontal: false, flip_vertical: false, auto_enhance: false, filter: "", brightness: 1, contrast: 1, saturation: 1, grayscale: 0, mute: false, playback_speed: 1 };
}

function libraryEditStyle(definition: LibraryEditDefinition) {
  const crop = definition.crop;
  const preset = definition.filter === "vivid" ? "contrast(1.08) saturate(1.28)" : definition.filter === "dramatic" ? "contrast(1.25) saturate(.82) brightness(.92)" : definition.filter === "warm" ? "sepia(.12) saturate(1.08)" : definition.filter === "cool" ? "hue-rotate(8deg) saturate(1.05)" : definition.filter === "mono" ? "grayscale(1)" : definition.filter === "noir" ? "grayscale(1) contrast(1.35) brightness(.96)" : "";
  const enhance = definition.auto_enhance ? "contrast(1.05) saturate(1.08) brightness(1.02)" : "";
  return {
    filter: `brightness(${definition.brightness}) contrast(${definition.contrast}) saturate(${definition.saturation}) grayscale(${definition.grayscale}) ${enhance} ${preset}`,
    transform: `rotate(${definition.rotation}deg) scaleX(${definition.flip_horizontal ? -1 : 1}) scaleY(${definition.flip_vertical ? -1 : 1})`,
    clipPath: crop ? `inset(${crop.y * 100}% ${(1 - crop.x - crop.width) * 100}% ${(1 - crop.y - crop.height) * 100}% ${crop.x * 100}%)` : undefined,
  };
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

function LibraryItemThumbnail({ spaceId, item }: { spaceId: string; item: SpaceLibraryItem }) {
  const [url, setUrl] = useState("");
  const mimeType = String(item.file.intrinsic_metadata.server_detected_mime_type ?? "").toLowerCase();
  const visual = mimeType.startsWith("image/") || mimeType.startsWith("video/") || Number(item.file.intrinsic_metadata.width ?? 0) > 0;
  useEffect(() => {
    if (!visual) {
      setUrl("");
      return;
    }
    let current = true;
    let objectUrl = "";
    void spacesApi.libraryPreview(spaceId, item.id).then((blob) => {
      if (!current) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => setUrl(""));
    return () => {
      current = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [item.id, item.version, mimeType, spaceId, visual]);
  return url ? <img className="size-full object-cover" src={url} alt=""/> : <File size={30}/>;
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
  return <div className="flex min-w-0 items-center gap-1.5"><span className="mr-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--misty-text-subtle)]">{label}</span>{facets.slice(0, 6).map((facet) => <button className={smallButtonClass} type="button" key={`${facet.value}:${facet.label}`} onClick={() => onSelect(facet)}>{facet.label}<span className="text-[var(--misty-text-subtle)]">{facet.count}</span></button>)}</div>;
}

function libraryUtilityIcon(value: string): LucideIcon {
  if (value === "recently-edited") return SlidersHorizontal;
  if (value === "recently-shared") return MessagesSquare;
  if (value === "screenshots") return ImageIcon;
  if (value === "handwriting") return Pencil;
  if (value === "illustrations") return Sparkles;
  if (value === "documents" || value === "receipts" || value === "qr-codes") return File;
  return History;
}

function LibraryCollectionCard({ icon: Icon, label, count, disabled = false, pinned = false, onClick, onTogglePin, onMoveEarlier, onMoveLater }: { icon: LucideIcon; label: string; count: number; disabled?: boolean; pinned?: boolean; onClick?: () => void; onTogglePin?: () => void; onMoveEarlier?: () => void; onMoveLater?: () => void }) {
  return <article className="group relative overflow-hidden rounded-2xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface)]"><button className="block w-full border-0 bg-transparent p-4 text-left disabled:opacity-40" type="button" disabled={disabled} onClick={onClick}><Icon size={22}/><p className="mb-0 mt-3 truncate text-xs font-medium">{label}</p><p className="mb-0 mt-1 text-[10px] text-[var(--misty-text-subtle)]">{count} items</p></button>{onTogglePin && !disabled ? <button className={`absolute right-2 top-2 grid size-7 place-items-center rounded-lg border-0 ${pinned ? "bg-[var(--misty-surface-3)] text-[var(--misty-text)]" : "bg-transparent text-[var(--misty-text-subtle)] opacity-0 group-hover:opacity-100 focus:opacity-100"}`} type="button" onClick={onTogglePin} title={pinned ? "Unpin" : "Pin collection"} aria-label={`${pinned ? "Unpin" : "Pin"} ${label}`}><Pin size={13} fill={pinned ? "currentColor" : "none"}/></button> : null}{onMoveEarlier || onMoveLater ? <span className="absolute bottom-2 right-2 flex gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100">{onMoveEarlier ? <button className="grid size-6 place-items-center rounded-md border-0 bg-[var(--misty-surface-2)] text-[var(--misty-text-muted)]" type="button" onClick={onMoveEarlier} title="Move earlier" aria-label={`Move ${label} earlier`}><ChevronLeft size={12}/></button> : null}{onMoveLater ? <button className="grid size-6 place-items-center rounded-md border-0 bg-[var(--misty-surface-2)] text-[var(--misty-text-muted)]" type="button" onClick={onMoveLater} title="Move later" aria-label={`Move ${label} later`}><ChevronRight size={12}/></button> : null}</span> : null}</article>;
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
    <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">{points.slice(0, 12).map((point) => <button className="rounded-xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface)] p-3 text-left" type="button" key={point.id} onClick={() => onSelect(point)}><p className="m-0 truncate text-xs font-medium">{point.name}</p><p className="mb-0 mt-1 text-[10px] text-[var(--misty-text-subtle)]">{point.item_count} items · {point.latitude.toFixed(2)}, {point.longitude.toFixed(2)}</p></button>)}</div>
  </div>;
}

function LibraryDiscoveryCard({ spaceId, group, fallbackIcon: Icon, pinned = false, onTogglePin, onClick }: { spaceId: string; group: LibraryDiscoveryGroup; fallbackIcon: LucideIcon; pinned?: boolean; onTogglePin?: () => void; onClick: () => void }) {
  return <article className="group relative overflow-hidden rounded-2xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface)]"><button className="block w-full border-0 bg-transparent p-0 text-left" type="button" onClick={onClick}><span className="relative block"><AlbumCover spaceId={spaceId} itemId={group.cover_item_id}/><span className="absolute left-3 top-3 grid size-8 place-items-center rounded-xl bg-black/55 text-white backdrop-blur"><Icon size={16}/></span></span><span className="block p-3"><span className="block truncate text-xs font-medium">{group.title}</span><span className="mt-1 block truncate text-[10px] text-[var(--misty-text-subtle)]">{group.subtitle}</span></span></button>{onTogglePin ? <button className={`absolute right-3 top-3 grid size-8 place-items-center rounded-xl border-0 backdrop-blur ${pinned ? "bg-white text-black" : "bg-black/55 text-white opacity-0 group-hover:opacity-100 focus:opacity-100"}`} type="button" onClick={onTogglePin} title={pinned ? "Unpin" : "Pin collection"} aria-label={`${pinned ? "Unpin" : "Pin"} ${group.title}`}><Pin size={14} fill={pinned ? "currentColor" : "none"}/></button> : null}</article>;
}

function SpaceMembers({ spaceId }: { spaceId: string }) {
  const { user } = useAuth();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const space = useSpacesStore((state) => state.spaces.find((item) => item.id === spaceId));
  const { membersBySpace, error, invite, removeMember, leaveSpace, transferOwner, deleteSpace, clearError } = useSpacesStore(useShallow((state) => ({
    membersBySpace: state.membersBySpace, error: state.error, invite: state.invite, removeMember: state.removeMember, leaveSpace: state.leaveSpace, transferOwner: state.transferOwner, deleteSpace: state.deleteSpace, clearError: state.clearError,
  })));
  const members = membersBySpace[spaceId] ?? emptyMembers;
  const owner = space?.role === "owner";
  const submitInvite = async (event: FormEvent) => {
    event.preventDefault();
    const email = inviteEmail.trim();
    if (!email || inviting) return;
    setInviting(true);
    try {
      await invite(spaceId, email);
      setInviteEmail("");
      setInviteOpen(false);
    } catch { /* the shared store error is rendered above the section */ }
    finally { setInviting(false); }
  };
  return <div className="h-full min-h-0 overflow-auto px-6 py-5">
    <div className="mb-5 flex items-center justify-between"><div><h3 className="m-0 text-base">Members</h3><p className="m-0 mt-1 text-xs text-[var(--misty-text-subtle)]">{space?.is_shared ? `Shared with ${members.length} people${space.pending_count ? ` · ${space.pending_count} pending` : ""}` : "Private · invite someone to share this Space"} · 5 people maximum</p></div>{owner && members.length + (space?.pending_count ?? 0) < 5 ? <button className={primaryButtonClass} type="button" onClick={() => { clearError(); setInviteOpen(true); }}><UserPlus size={15}/>Invite</button> : null}</div>
    <div className="overflow-hidden rounded-2xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface)]">
      {members.map((member) => <article className="flex min-h-16 items-center gap-3 border-b border-[var(--misty-border-soft)] px-4 last:border-0" key={member.user_id}><span className="grid size-9 place-items-center rounded-full bg-[var(--misty-surface-3)] text-xs font-semibold">{member.name.slice(0,2).toUpperCase()}</span><div className="min-w-0 flex-1"><p className="m-0 truncate text-sm font-medium">{member.name}{member.user_id === user?.id ? " (you)" : ""}</p><p className="m-0 truncate text-[11px] text-[var(--misty-text-subtle)]">{member.email}</p></div><span className="rounded-lg bg-[var(--misty-surface-2)] px-2 py-1 text-[10px] capitalize text-[var(--misty-text-muted)]">{member.role}</span>{owner && member.role !== "owner" ? <><MemberPermissionControls spaceId={spaceId} userId={member.user_id}/><button className={smallButtonClass} type="button" onClick={() => window.confirm(`Make ${member.name} the owner?`) && void transferOwner(spaceId, member.user_id)}>Transfer</button><button className={rowActionClass} type="button" onClick={() => window.confirm(`Remove ${member.name} from this Space?`) && void removeMember(spaceId, member.user_id)}><Trash2 size={14}/></button></> : null}</article>)}
    </div>
    {owner && space?.is_personal ? <section className="mt-8 rounded-2xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface)] p-4"><h4 className="m-0 text-sm">Your default Space</h4><p className="mb-0 mt-1 text-xs leading-relaxed text-[var(--misty-text-subtle)]">This Space can be renamed, but cannot be deleted or transferred. It remains private until you invite someone, and you can remove members again at any time.</p></section> : owner ? <section className="mt-8 rounded-2xl border border-red-500/20 bg-red-950/10 p-4"><h4 className="m-0 text-sm text-red-200">Delete Space</h4><p className="mb-3 mt-1 text-xs leading-relaxed text-red-200/60">Removes access immediately and schedules permanent deletion after recovery and storage safety checks. The Space continues using an ownership slot until deletion finishes.</p><button className="rounded-lg border border-red-400/25 bg-red-500/10 px-3 py-2 text-xs text-red-200" type="button" onClick={() => { const confirmation = window.prompt(`Type “${space?.name ?? ""}” to schedule this Space for deletion.`); if (space && confirmation === space.name) void deleteSpace(spaceId, confirmation).then(() => window.location.assign("/spaces/personal")); }}>Delete Space</button></section> : <section className="mt-8 rounded-2xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface)] p-4"><h4 className="m-0 text-sm">Leave Space</h4><p className="mb-3 mt-1 text-xs text-[var(--misty-text-subtle)]">You will immediately lose access to chat and protected Library items.</p><button className={secondaryButtonClass} type="button" onClick={() => window.confirm(`Leave ${space?.name ?? "this Space"}?`) && void leaveSpace(spaceId).then(() => window.location.assign("/spaces/personal"))}>Leave Space</button></section>}
    {inviteOpen ? (
      <div className="fixed inset-0 z-[2147483000] grid place-items-center bg-black/60 p-6" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !inviting) setInviteOpen(false); }}>
        <form className="w-full max-w-sm rounded-2xl border border-[var(--misty-border-strong)] bg-[var(--misty-modal-bg,var(--misty-surface))] p-5 shadow-2xl" onSubmit={(event) => void submitInvite(event)}>
          <div className="flex items-start justify-between gap-4">
            <div><h2 className="m-0 text-base font-semibold">Invite to {space?.name ?? "Space"}</h2><p className="mb-0 mt-1 text-xs leading-relaxed text-[var(--misty-text-subtle)]">Invitations work with an existing Misty account and expire after seven days.</p></div>
            <button className={iconButtonClass} type="button" disabled={inviting} onClick={() => setInviteOpen(false)} aria-label="Close invite"><X size={15}/></button>
          </div>
          <label className="mt-5 grid gap-2 text-xs font-medium text-[var(--misty-text-muted)]">Email address<input className={inputClass} autoFocus type="email" autoComplete="email" placeholder="teammate@example.com" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} /></label>
          {error ? <p className="mb-0 mt-3 rounded-xl border border-red-400/20 bg-red-950/20 px-3 py-2 text-xs leading-relaxed text-red-200" role="alert">{error}</p> : null}
          <div className="mt-5 flex justify-end gap-2"><button className={secondaryButtonClass} type="button" disabled={inviting} onClick={() => setInviteOpen(false)}>Cancel</button><button className={primaryButtonClass} type="submit" disabled={inviting || !inviteEmail.trim()}>{inviting ? "Sending…" : "Send invite"}</button></div>
        </form>
      </div>
    ) : null}
  </div>;
}

function MemberPermissionControls({ spaceId, userId }: { spaceId: string; userId: string }) {
  const [permissions, setPermissions] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let current = true;
    void spacesApi.memberPermissions(spaceId, userId).then((result) => current && setPermissions(result.permissions)).catch(() => undefined);
    return () => { current = false; };
  }, [spaceId, userId]);
  const setContribute = async (allowed: boolean) => {
    setSaving(true);
    try {
      let latest = permissions;
      for (const permission of ["library.upload", "attachments.upload", "library.add"]) {
        latest = (await spacesApi.setMemberPermission(spaceId, userId, permission, allowed ? "allow" : "deny")).permissions;
      }
      setPermissions(latest);
    } finally { setSaving(false); }
  };
  const contribute = Boolean(permissions["library.upload"] && permissions["attachments.upload"] && permissions["library.add"]);
  return <div className="flex gap-1"><button className={smallButtonClass} type="button" disabled={saving} onClick={() => void setContribute(!contribute)}>{contribute ? "Can contribute" : "Read only"}</button><button className={smallButtonClass} type="button" disabled={saving} onClick={() => void spacesApi.setMemberPermission(spaceId, userId, "library.edit", permissions["library.edit"] ? "deny" : "allow").then((result) => setPermissions(result.permissions))}>{permissions["library.edit"] ? "Can organize" : "No edits"}</button></div>;
}

function spaceLinkClass({ isActive }: { isActive: boolean }) {
  return `flex min-h-10 items-center gap-2 rounded-xl px-2.5 text-xs no-underline ${isActive ? "bg-[var(--misty-surface-3)] text-[var(--misty-text)]" : "text-[var(--misty-text-muted)] hover:bg-[var(--misty-surface-2)]"}`;
}

const iconButtonClass = "grid size-8 place-items-center rounded-xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] p-0 text-[var(--misty-text)]";
const smallButtonClass = "inline-flex items-center gap-1 rounded-lg border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] px-2 py-1 text-[10px] text-[var(--misty-text-muted)]";
const secondaryButtonClass = "inline-flex min-h-9 items-center gap-2 rounded-xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] px-3 text-xs text-[var(--misty-text)]";
const primaryButtonClass = "inline-flex min-h-9 items-center gap-2 rounded-xl border-0 bg-[var(--misty-primary)] px-3 text-xs text-[var(--misty-primary-contrast)]";
const rowActionClass = "invisible grid size-7 place-items-center rounded-lg border-0 bg-transparent text-[var(--misty-text-subtle)] hover:bg-[var(--misty-surface-2)] group-hover:visible";
const inputClass = "min-h-10 rounded-xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] px-3 text-sm text-[var(--misty-text)] outline-none focus:border-[var(--misty-primary)]";
const libraryControlClass = "h-8 shrink-0 rounded-lg border border-[var(--misty-border-soft)] bg-[var(--misty-surface)] px-2 text-xs text-[var(--misty-text-muted)] outline-none";

function compareLibraryItems(left: SpaceLibraryItem, right: SpaceLibraryItem, sort: NonNullable<LibraryItemQuery["sort"]>, direction: NonNullable<LibraryItemQuery["direction"]>) {
  const multiplier = direction === "asc" ? 1 : -1;
  let result = 0;
  if (sort === "name") result = left.display_name.localeCompare(right.display_name);
  else if (sort === "size") result = Number(left.file.intrinsic_metadata.byte_size ?? 0) - Number(right.file.intrinsic_metadata.byte_size ?? 0);
  else if (sort === "date-captured") result = new Date(left.date_override ?? String(left.file.intrinsic_metadata.capture_timestamp ?? left.file.original_uploaded_at)).getTime() - new Date(right.date_override ?? String(right.file.intrinsic_metadata.capture_timestamp ?? right.file.original_uploaded_at)).getTime();
  else result = new Date(left.added_at).getTime() - new Date(right.added_at).getTime();
  return result === 0 ? left.id.localeCompare(right.id) * multiplier : result * multiplier;
}

function libraryDateGroupLabel(item: SpaceLibraryItem, sort: NonNullable<LibraryItemQuery["sort"]>) {
  if (sort === "name" || sort === "size" || sort === "album-order") return "";
  const value = sort === "date-captured" ? item.date_override ?? String(item.file.intrinsic_metadata.capture_timestamp ?? item.file.original_uploaded_at) : item.added_at;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  const today = new Date();
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const currentDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (day === currentDay) return "Today";
  if (day === currentDay - 86_400_000) return "Yesterday";
  return date.toLocaleDateString([], { month: "long", year: "numeric" });
}

function libraryFacetPrefix(input: string) {
  const tokens = input.trim().split(/\s+/);
  const token = tokens[tokens.length - 1] ?? "";
  const value = token.includes(":") ? token.slice(token.indexOf(":") + 1) : token;
  return value.replace(/"/g, "").slice(0, 120);
}

function formatTime(value: string) { return new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(value >= 10_000_000_000 ? 0 : 1)} GB`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} MB`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)} KB`;
  return `${value} B`;
}

const emptyMessages: SpaceMessage[] = [];
const emptyMembers: SpaceMember[] = [];
const emptyNodes: SpaceNode[] = [];
const emptyStudioResources: SpaceStudioResource[] = [];
