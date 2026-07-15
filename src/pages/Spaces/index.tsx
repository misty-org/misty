import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Navigate, NavLink, Outlet, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Check,
  Cloud,
  Download,
  ExternalLink,
  File,
  Folder,
  FolderPlus,
  Hash,
  Link,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Plus,
  Send,
  Trash2,
  UserPlus,
  Users,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useAuth } from "../../auth/AuthContext";
import LibraryPage from "../Library";
import { useSpacesStore } from "../../stores/useSpacesStore";
import type { MessageSpan, SpaceMember, SpaceMessage, SpaceNode, SpaceStudioResource } from "../../spaces/types";

export default function SpacesShell() {
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [creating, setCreating] = useState(false);
  const { spaces, invitations, loading, error, load, createSpace, respondInvite, clearError } = useSpacesStore(useShallow((state) => ({
    spaces: state.spaces,
    invitations: state.invitations,
    loading: state.loading,
    error: state.error,
    load: state.load,
    createSpace: state.createSpace,
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
      navigate(`/spaces/${encodeURIComponent(created.id)}/chat`);
    } catch { /* the dialog renders the store error */ }
    finally { setCreating(false); }
  };

  return (
    <div className="grid h-full min-h-0 grid-cols-[220px_minmax(0,1fr)] bg-[var(--misty-app-page-bg,#07090b)]">
      <aside className="min-h-0 overflow-auto border-r border-[var(--misty-border-soft)] bg-[var(--misty-surface)] px-3 py-4">
        <div className="mb-4 flex items-center justify-between px-2">
          <div>
            <h1 className="m-0 text-lg font-semibold text-[var(--misty-text)]">Spaces</h1>
            <p className="m-0 mt-0.5 text-[11px] text-[var(--misty-text-subtle)]">Private until you invite someone</p>
          </div>
          <button className={iconButtonClass} type="button" onClick={() => { clearError(); setCreateOpen(true); }} aria-label="Create Space" title="Create Space">
            <Plus size={16} />
          </button>
        </div>
        {error && !createOpen ? <button className="mb-3 w-full rounded-xl border border-red-400/20 bg-red-950/20 px-3 py-2 text-left text-[11px] leading-relaxed text-red-200" type="button" onClick={clearError}>{error}</button> : null}
        <nav className="grid gap-1" aria-label="Spaces">
          {spaces.map((space) => (
            <NavLink key={space.id} className={spaceLinkClass} to={`/spaces/${encodeURIComponent(space.id)}/${space.is_personal ? "files" : "chat"}`}>
              <span className="grid size-7 place-items-center rounded-lg bg-[var(--misty-surface-3)] text-[11px] font-bold">{space.name.slice(0, 2).toUpperCase()}</span>
              <span className="min-w-0 flex-1 truncate">{space.name}</span>
              <span className={`rounded-md px-1.5 py-0.5 text-[9px] ${space.is_shared ? "bg-emerald-500/10 text-emerald-300" : "bg-[var(--misty-surface-2)] text-[var(--misty-text-subtle)]"}`}>{space.is_shared ? "Shared" : "Private"}</span>
            </NavLink>
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
              <div><h2 className="m-0 text-base font-semibold">Create a Space</h2><p className="mb-0 mt-1 text-xs leading-relaxed text-[var(--misty-text-subtle)]">It starts private. Invite teammates later when you want to share it.</p></div>
              <button className={iconButtonClass} type="button" disabled={creating} onClick={() => { clearError(); setCreateOpen(false); }} aria-label="Close"><X size={15}/></button>
            </div>
            <label className="mt-5 grid gap-2 text-xs font-medium text-[var(--misty-text-muted)]">Space name<input className={inputClass} autoFocus maxLength={80} placeholder="Design team" value={createName} onChange={(event) => setCreateName(event.target.value)} /></label>
            {error ? <p className="mb-0 mt-3 rounded-xl border border-red-400/20 bg-red-950/20 px-3 py-2 text-xs leading-relaxed text-red-200" role="alert">{error}</p> : null}
            <div className="mt-5 flex justify-end gap-2"><button className={secondaryButtonClass} type="button" disabled={creating} onClick={() => { clearError(); setCreateOpen(false); }}>Cancel</button><button className={primaryButtonClass} type="submit" disabled={creating || !createName.trim()}>{creating ? "Creating…" : "Create Space"}</button></div>
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

  if (personal) return <Navigate to={`/spaces/${encodeURIComponent(personal.id)}/files`} replace />;
  return <div className="grid h-full place-items-center text-sm text-[var(--misty-text-muted)]">Loading Personal Space…</div>;
}

export function SpaceDetail() {
  const { spaceId = "", section = "chat" } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { spaces, loading, realtimeConnected, error, loadSpace, clearError } = useSpacesStore(useShallow((state) => ({
    spaces: state.spaces,
    loading: state.loading,
    realtimeConnected: state.realtimeConnected,
    error: state.error,
    loadSpace: state.loadSpace,
    clearError: state.clearError,
  })));
  const space = spaces.find((item) => item.id === spaceId);

  useEffect(() => { if (spaceId) void loadSpace(spaceId); }, [loadSpace, spaceId, user?.id]);

  if (!space && !loading) {
    return <div className="grid h-full place-items-center text-sm text-[var(--misty-text-muted)]">This Space is unavailable.</div>;
  }

  return (
    <div className="grid h-full min-h-0 grid-rows-[64px_minmax(0,1fr)]">
      <header className="flex items-center justify-between border-b border-[var(--misty-border-soft)] px-6">
        <div className="min-w-0">
          <h2 className="m-0 truncate text-lg font-semibold">{space?.name ?? "Space"}</h2>
          <span className="inline-flex items-center gap-1 text-[11px] text-[var(--misty-text-subtle)]">
            {space?.is_shared ? `${space.member_count} people · Shared` : "Private"} · {realtimeConnected ? <Wifi size={11} /> : <WifiOff size={11} />}{realtimeConnected ? "Live" : "Reconnecting"}
          </span>
        </div>
        <nav className="flex rounded-xl bg-[var(--misty-surface-2)] p-1" aria-label="Space sections">
          {(["chat", "files", "members"] as const).map((item) => (
            <button key={item} className={`rounded-lg border-0 px-3 py-1.5 text-xs capitalize ${section === item ? "bg-[var(--misty-surface-3)] text-[var(--misty-text)]" : "bg-transparent text-[var(--misty-text-muted)]"}`} type="button" onClick={() => navigate(`/spaces/${encodeURIComponent(spaceId)}/${item}`)}>{item}</button>
          ))}
        </nav>
      </header>
      <div className="relative min-h-0">
        {error ? <button className="absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded-lg border border-red-400/30 bg-red-950/80 px-3 py-2 text-xs text-red-100" type="button" onClick={clearError}>{error}</button> : null}
        {section === "files" ? (space?.is_personal ? <PersonalSpaceFiles spaceId={spaceId} /> : <SpaceFiles spaceId={spaceId} />) : section === "members" ? <SpaceMembers spaceId={spaceId} /> : <SpaceChat spaceId={spaceId} />}
      </div>
    </div>
  );
}

function SpaceChat({ spaceId }: { spaceId: string }) {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const endRef = useRef<HTMLDivElement | null>(null);
  const [text, setText] = useState("");
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const { messagesBySpace, membersBySpace, agentsBySpace, nodesBySpace, sending, sendMessage, updateMessage, deleteMessage, markRead, loadStudio, openNode } = useSpacesStore(useShallow((state) => ({
    messagesBySpace: state.messagesBySpace,
    membersBySpace: state.membersBySpace,
    agentsBySpace: state.agentsBySpace,
    nodesBySpace: state.nodesBySpace,
    sending: state.sending,
    sendMessage: state.sendMessage,
    updateMessage: state.updateMessage,
    deleteMessage: state.deleteMessage,
    markRead: state.markRead,
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
    void loadStudio(spaceId, "agents");
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
    const value = text.trim(); if (!value) return;
    try { await sendMessage(spaceId, value, selectedFileIds); setText(""); setSelectedFileIds([]); } catch { /* store renders error */ }
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
              <div className="flex items-baseline gap-2"><strong className="text-sm">{message.sender_name}{message.sender_kind === "person" && message.sender_user_id === user?.id ? " (me)" : ""}</strong>{message.sender_kind === "agent" ? <span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-violet-300">Agent</span> : null}<time className="text-[10px] text-[var(--misty-text-subtle)]">{formatTime(message.created_at)}</time></div>
              <p className="m-0 mt-1 whitespace-pre-wrap text-sm leading-relaxed text-[var(--misty-text-muted)]">{message.content.map((span, index) => <MessageContent key={index} span={span} />)}</p>
              {message.file_node_ids.length > 0 ? <div className="mt-2 flex flex-wrap gap-1.5">{message.file_node_ids.map((nodeId) => { const node = nodes.find((item) => item.id === nodeId); return <button className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] px-2 py-1 text-[10px] text-sky-200" type="button" key={nodeId} onClick={() => void openNode(spaceId, nodeId)}><Paperclip size={11}/>{node?.display_name ?? "Drive file"}</button>; })}</div> : null}
            </div>
            <div className="flex gap-1">{message.sender_kind === "person" && message.sender_user_id === user?.id ? <button className="invisible grid size-7 place-items-center rounded-lg border-0 bg-transparent text-[var(--misty-text-subtle)] hover:bg-[var(--misty-surface-2)] group-hover:visible" type="button" onClick={() => { const current = message.content.map((span) => span.type === "text" ? span.text : `@${span.label}`).join(""); const edited = window.prompt("Edit message", current); if (edited?.trim() && edited.trim() !== current) void updateMessage(spaceId, message.id, edited, message.file_node_ids); }} aria-label="Edit message"><Pencil size={14}/></button> : null}{(message.sender_user_id === user?.id || useSpacesStore.getState().spaces.find((item) => item.id === spaceId)?.role === "owner") ? <button className="invisible grid size-7 place-items-center rounded-lg border-0 bg-transparent text-[var(--misty-text-subtle)] hover:bg-[var(--misty-surface-2)] group-hover:visible" type="button" onClick={() => window.confirm("Remove this message?") && void deleteMessage(spaceId, message.id)} aria-label="Remove message"><Trash2 size={14} /></button> : null}</div>
          </article>
        ))}
        <div ref={endRef} />
      </div>
      <form className="mx-[clamp(20px,5vw,72px)] mb-5 rounded-2xl border border-[var(--misty-border-strong)] bg-[var(--misty-surface)] p-2" onSubmit={(event) => void submit(event)}>
        <textarea className="min-h-[54px] w-full resize-none border-0 bg-transparent px-3 py-2 text-sm text-[var(--misty-text)] outline-none" maxLength={4000} placeholder="Message this Space — use @name to mention people or Agents" value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
        <div className="flex items-center justify-between gap-3 px-2 pb-1">
          <div className="flex min-w-0 items-center gap-1 overflow-auto">
            <label className="relative grid size-7 shrink-0 place-items-center rounded-lg bg-[var(--misty-surface-2)] text-[var(--misty-text-muted)]" title="Attach a Space file">
              <Paperclip size={13}/>
              <select className="absolute inset-0 opacity-0" value="" onChange={(event) => { const id = event.target.value; if (id && !selectedFileIds.includes(id) && selectedFileIds.length < 5) setSelectedFileIds((current) => [...current, id]); }} aria-label="Attach a Space file"><option value="">Attach file</option>{nodes.filter((node) => !selectedFileIds.includes(node.id)).map((node) => <option value={node.id} key={node.id}>{node.display_name}</option>)}</select>
            </label>
            {[...members.filter((member) => member.user_id !== user?.id), ...agents].slice(0, 6).map((item) => <button className="whitespace-nowrap rounded-md border-0 bg-[var(--misty-surface-2)] px-2 py-1 text-[10px] text-[var(--misty-text-muted)]" type="button" key={"user_id" in item ? item.user_id : item.id} onClick={() => setText((current) => `${current}${current && !current.endsWith(" ") ? " " : ""}@${item.name} `)}>@{item.name}</button>)}
          </div>
          <button className="grid size-8 shrink-0 place-items-center rounded-xl border-0 bg-[var(--misty-primary)] text-[var(--misty-primary-contrast)] disabled:opacity-50" disabled={sending || !text.trim()} type="submit"><Send size={15} /></button>
        </div>
        {selectedFileIds.length > 0 ? <div className="flex flex-wrap gap-1 px-2 pb-1">{selectedFileIds.map((id) => <button className="rounded-md border-0 bg-sky-500/10 px-2 py-1 text-[9px] text-sky-200" type="button" key={id} onClick={() => setSelectedFileIds((current) => current.filter((item) => item !== id))}>{nodes.find((node) => node.id === id)?.display_name ?? "Drive file"} ×</button>)}</div> : null}
      </form>
    </div>
  );
}

function MessageContent({ span }: { span: MessageSpan }) {
  if (span.type === "text") return <>{span.text}</>;
  return <span className="rounded bg-violet-500/15 px-1 py-0.5 font-medium text-violet-300">@{span.label}</span>;
}

function PersonalSpaceFiles({ spaceId }: { spaceId: string }) {
  const [view, setView] = useState<"private" | "shared">("private");
  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
      <div className="flex items-center justify-between border-b border-[var(--misty-border-soft)] px-6 py-3">
        <div>
          <p className="m-0 text-xs font-medium">Personal files</p>
          <p className="m-0 mt-0.5 text-[11px] text-[var(--misty-text-subtle)]">Local Library items stay private. Only Drive links you explicitly add under Shared files are visible to members.</p>
        </div>
        <div className="flex rounded-xl bg-[var(--misty-surface-2)] p-1" role="tablist" aria-label="Personal file visibility">
          <button className={`rounded-lg border-0 px-3 py-1.5 text-xs ${view === "private" ? "bg-[var(--misty-surface-3)] text-[var(--misty-text)]" : "bg-transparent text-[var(--misty-text-muted)]"}`} type="button" role="tab" aria-selected={view === "private"} onClick={() => setView("private")}>Private Library</button>
          <button className={`rounded-lg border-0 px-3 py-1.5 text-xs ${view === "shared" ? "bg-[var(--misty-surface-3)] text-[var(--misty-text)]" : "bg-transparent text-[var(--misty-text-muted)]"}`} type="button" role="tab" aria-selected={view === "shared"} onClick={() => setView("shared")}>Shared files</button>
        </div>
      </div>
      <div className="min-h-0">{view === "private" ? <LibraryPage /> : <SpaceFiles spaceId={spaceId} />}</div>
    </div>
  );
}

function SpaceFiles({ spaceId }: { spaceId: string }) {
  const navigate = useNavigate();
  const { nodesBySpace, createFolder, addDriveLink, updateNode, removeNode, openNode } = useSpacesStore(useShallow((state) => ({
    nodesBySpace: state.nodesBySpace,
    createFolder: state.createFolder,
    addDriveLink: state.addDriveLink,
    updateNode: state.updateNode,
    removeNode: state.removeNode,
    openNode: state.openNode,
  })));
  const nodes = nodesBySpace[spaceId] ?? emptyNodes;

  const addFolder = async () => { const name = window.prompt("Folder name"); if (name?.trim()) await createFolder(spaceId, name.trim()); };
  const addLink = async () => {
    const driveUrl = window.prompt("Google Drive link"); if (!driveUrl?.trim()) return;
    const displayName = window.prompt("Name in this Space", "Drive file")?.trim(); if (!displayName) return;
    await addDriveLink(spaceId, { displayName, driveUrl: driveUrl.trim() });
  };
  const roots = useMemo(() => nodes.filter((node) => !node.parent_id), [nodes]);

  return (
    <div className="h-full min-h-0 overflow-auto px-6 py-5">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div><h3 className="m-0 text-base">Shared library</h3><p className="m-0 mt-1 text-xs text-[var(--misty-text-subtle)]">Files stay in each uploader’s Google Drive. Misty stores protected links and this virtual hierarchy.</p></div>
        <div className="flex gap-2">
          <button className={secondaryButtonClass} type="button" onClick={() => navigate("/files")}><Cloud size={15} />Upload in Files</button>
          <button className={secondaryButtonClass} type="button" onClick={() => void addFolder()}><FolderPlus size={15} />Folder</button>
          <button className={primaryButtonClass} type="button" onClick={() => void addLink()}><Link size={15} />Add Drive link</button>
        </div>
      </div>
      <div className="overflow-hidden rounded-2xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface)]">
        {roots.length === 0 ? <div className="grid min-h-[260px] place-items-center text-center"><div><Folder size={30} className="mx-auto text-[var(--misty-text-subtle)]"/><p className="mb-1 mt-3 text-sm">No shared files yet</p><p className="m-0 text-xs text-[var(--misty-text-subtle)]">Upload to Google Drive, then add its sharing link here.</p></div></div> : roots.map((node) => <SpaceNodeRow key={node.id} node={node} allNodes={nodes} depth={0} spaceId={spaceId} openNode={openNode} updateNode={updateNode} removeNode={removeNode} />)}
      </div>
      <p className="mt-4 max-w-2xl text-[11px] leading-relaxed text-[var(--misty-text-subtle)]">When a Space Agent reads a selected file, Misty temporarily processes an encrypted copy for up to 24 hours. Normal viewing and downloads go directly to Google Drive.</p>
    </div>
  );
}

function SpaceNodeRow(props: { node: SpaceNode; allNodes: SpaceNode[]; depth: number; spaceId: string; openNode: ReturnType<typeof useSpacesStore.getState>["openNode"]; updateNode: ReturnType<typeof useSpacesStore.getState>["updateNode"]; removeNode: ReturnType<typeof useSpacesStore.getState>["removeNode"] }) {
  const children = props.allNodes.filter((item) => item.parent_id === props.node.id);
  const rename = async () => { const displayName = window.prompt("Rename in Space", props.node.display_name)?.trim(); if (displayName && displayName !== props.node.display_name) await props.updateNode(props.spaceId, props.node, { display_name: displayName }); };
  return <>
    <div className="group flex min-h-12 items-center gap-3 border-b border-[var(--misty-border-soft)] px-3 text-sm last:border-0" style={{ paddingLeft: 14 + props.depth * 24 }}>
      {props.node.kind === "folder" ? <Folder size={17} className="text-amber-300" /> : <File size={17} className="text-sky-300" />}
      <button className="min-w-0 flex-1 truncate border-0 bg-transparent text-left text-[var(--misty-text)]" type="button" onDoubleClick={() => props.node.kind === "link" && void props.openNode(props.spaceId, props.node.id, "open")}>{props.node.display_name}{props.node.stale ? <span className="ml-2 text-[10px] text-amber-300">Unavailable</span> : null}</button>
      {props.node.kind === "link" ? <><button className={rowActionClass} type="button" title="Open in Google Drive" onClick={() => void props.openNode(props.spaceId, props.node.id, "open")}><ExternalLink size={14}/></button><button className={rowActionClass} type="button" title="Download from Google Drive" onClick={() => void props.openNode(props.spaceId, props.node.id, "download")}><Download size={14}/></button></> : null}
      <button className={rowActionClass} type="button" title="Rename in Space" onClick={() => void rename()}><MoreHorizontal size={14}/></button>
      <button className={rowActionClass} type="button" title="Remove from Space" onClick={() => window.confirm(`Remove “${props.node.display_name}” from this Space? The Google Drive file will not be deleted.`) && void props.removeNode(props.spaceId, props.node.id)}><Trash2 size={14}/></button>
    </div>
    {children.map((child) => <SpaceNodeRow {...props} key={child.id} node={child} depth={props.depth + 1} />)}
  </>;
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
      {members.map((member) => <article className="flex min-h-16 items-center gap-3 border-b border-[var(--misty-border-soft)] px-4 last:border-0" key={member.user_id}><span className="grid size-9 place-items-center rounded-full bg-[var(--misty-surface-3)] text-xs font-semibold">{member.name.slice(0,2).toUpperCase()}</span><div className="min-w-0 flex-1"><p className="m-0 truncate text-sm font-medium">{member.name}{member.user_id === user?.id ? " (you)" : ""}</p><p className="m-0 truncate text-[11px] text-[var(--misty-text-subtle)]">{member.email}</p></div><span className="rounded-lg bg-[var(--misty-surface-2)] px-2 py-1 text-[10px] capitalize text-[var(--misty-text-muted)]">{member.role}</span>{owner && member.role !== "owner" ? <><button className={smallButtonClass} type="button" onClick={() => window.confirm(`Make ${member.name} the owner?`) && void transferOwner(spaceId, member.user_id)}>Transfer</button><button className={rowActionClass} type="button" onClick={() => window.confirm(`Remove ${member.name} from this Space?`) && void removeMember(spaceId, member.user_id)}><Trash2 size={14}/></button></> : null}</article>)}
    </div>
    {owner && space?.is_personal ? <section className="mt-8 rounded-2xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface)] p-4"><h4 className="m-0 text-sm">Your default Space</h4><p className="mb-0 mt-1 text-xs leading-relaxed text-[var(--misty-text-subtle)]">Personal cannot be deleted or transferred. It remains private until you invite someone, and you can remove members again at any time.</p></section> : owner ? <section className="mt-8 rounded-2xl border border-red-500/20 bg-red-950/10 p-4"><h4 className="m-0 text-sm text-red-200">Delete Space</h4><p className="mb-3 mt-1 text-xs leading-relaxed text-red-200/60">Immediately deletes Misty chat, membership, links, Agents, and Workflows. Google Drive folders and files remain untouched.</p><button className="rounded-lg border border-red-400/25 bg-red-500/10 px-3 py-2 text-xs text-red-200" type="button" onClick={() => { const confirmation = window.prompt(`Type “${space?.name ?? ""}” to permanently delete this Space.`); if (space && confirmation === space.name) void deleteSpace(spaceId, confirmation).then(() => window.location.assign("/spaces/personal")); }}>Delete Space</button></section> : <section className="mt-8 rounded-2xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface)] p-4"><h4 className="m-0 text-sm">Leave Space</h4><p className="mb-3 mt-1 text-xs text-[var(--misty-text-subtle)]">You will immediately lose access to chat and protected Drive links.</p><button className={secondaryButtonClass} type="button" onClick={() => window.confirm(`Leave ${space?.name ?? "this Space"}?`) && void leaveSpace(spaceId).then(() => window.location.assign("/spaces/personal"))}>Leave Space</button></section>}
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

function spaceLinkClass({ isActive }: { isActive: boolean }) {
  return `flex min-h-10 items-center gap-2 rounded-xl px-2.5 text-xs no-underline ${isActive ? "bg-[var(--misty-surface-3)] text-[var(--misty-text)]" : "text-[var(--misty-text-muted)] hover:bg-[var(--misty-surface-2)]"}`;
}

const iconButtonClass = "grid size-8 place-items-center rounded-xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] p-0 text-[var(--misty-text)]";
const smallButtonClass = "inline-flex items-center gap-1 rounded-lg border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] px-2 py-1 text-[10px] text-[var(--misty-text-muted)]";
const secondaryButtonClass = "inline-flex min-h-9 items-center gap-2 rounded-xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] px-3 text-xs text-[var(--misty-text)]";
const primaryButtonClass = "inline-flex min-h-9 items-center gap-2 rounded-xl border-0 bg-[var(--misty-primary)] px-3 text-xs text-[var(--misty-primary-contrast)]";
const rowActionClass = "invisible grid size-7 place-items-center rounded-lg border-0 bg-transparent text-[var(--misty-text-subtle)] hover:bg-[var(--misty-surface-2)] group-hover:visible";
const inputClass = "min-h-10 rounded-xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] px-3 text-sm text-[var(--misty-text)] outline-none focus:border-[var(--misty-primary)]";

function formatTime(value: string) { return new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }

const emptyMessages: SpaceMessage[] = [];
const emptyMembers: SpaceMember[] = [];
const emptyNodes: SpaceNode[] = [];
const emptyStudioResources: SpaceStudioResource[] = [];
