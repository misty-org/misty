import {
  AgentAvatar,
  AgentConversationPanel,
  useAgentActivity,
  usePersonalAgentsStore,
} from "@/features/agents";
import { notesApi } from "@/api/notes/api";
import { AiSurfaceButton } from "@/features/ai-surface/AiPaneHost";
import { useSpacesStore } from "@/features/spaces";
import {
  Button,
  EmptyState,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  cn,
} from "@/shared/ui";
import {
  Bot,
  ChevronRight,
  ExternalLink,
  FileText,
  Link2,
  LoaderCircle,
  PanelRightClose,
  Send,
  Sparkles,
} from "lucide-react";
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import type { Text as YText } from "yjs";
import { useShallow } from "zustand/react/shallow";
import { useNoteCollaborationRoom } from "../hooks/useNoteCollaborationRoom";
import type { NoteBodyFormat, UnifiedNote } from "../model/types/types";
import { relativeTime } from "../noteFilters";
import { NoteSourceBadge, NoteSyncIndicator } from "./NoteSourceBadge";

const NoteBlockEditor = lazy(() => import("./NoteBlockEditor"));
const paneClass = "grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-charcoal-bg";
const headerClass =
  "flex min-h-[58px] shrink-0 items-center gap-3 border-b border-charcoal-border bg-charcoal-bg px-4 py-2";

export function NoteReadingPane(props: NoteReadingPaneProps) {
  const { note } = props;
  const [inspector, setInspector] = useState<"backlinks" | "agent" | null>(null);
  useEffect(() => setInspector(null), [note?.id]);

  if (props.loading) return <ReadingPaneSkeleton />;
  if (!note) {
    return (
      <div className={paneClass}>
        <div className="row-span-2 grid place-items-center">
          <EmptyState
            title={props.hasNotes ? "Select a note" : "No notes yet"}
            description={
              props.hasNotes
                ? "Choose a note from the list to open it."
                : "Create a note to keep this Space's work close by."
            }
            className="max-w-sm px-6 py-8"
            action={
              props.hasNotes ? undefined : (
                <Button type="button" onClick={props.onNewNote}>
                  New note
                </Button>
              )
            }
          />
        </div>
      </div>
    );
  }

  const collaborative = !props.referenceOnly && note.source === "misty" && Boolean(note.spaceId);
  const editable = collaborative || Boolean(props.onSaveContent || props.onSaveBody);
  const linkableNotes = (props.linkableNotes ?? [])
    .filter((candidate) => candidate.id !== note.id && candidate.source === "misty")
    .map((candidate) => ({ id: candidate.sourceId, title: candidate.title }));

  return (
    <article className={paneClass} aria-label={note.title}>
      <header className={headerClass}>
        <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-charcoal-card text-cream-muted ring-1 ring-cream/10">
          <FileText size={16} />
        </div>
        <div className="min-w-0 flex-1">
          {collaborative && note.spaceId ? (
            <CollaborativeTitleInput
              spaceId={note.spaceId}
              noteId={note.sourceId}
              initialTitle={note.title}
            />
          ) : (
            <h1 className="m-0 truncate text-[15px] font-semibold leading-tight text-cream-bright">
              {note.title}
            </h1>
          )}
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-cream-muted">
            <span className="truncate">{note.spaceName}</span>
            <span aria-hidden="true">·</span>
            <span className="shrink-0">Updated {relativeTime(note.updatedAt)}</span>
            <NoteSourceBadge source={note.source} />
            <NoteSyncIndicator status={note.syncStatus} />
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <AiSurfaceButton />
          {note.source === "notion" && props.onOpenInSource ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 gap-1.5"
              onClick={() => props.onOpenInSource?.(note.id)}
            >
              <ExternalLink size={14} />
              <span className="hidden 2xl:inline">Open in Notion</span>
            </Button>
          ) : null}
          {note.source === "misty" && props.onPublish ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 gap-1.5"
              disabled={props.publishing}
              onClick={() => props.onPublish?.(note.id)}
            >
              {props.publishing ? (
                <LoaderCircle className="animate-spin" size={14} />
              ) : (
                <Send size={14} />
              )}
              <span className="hidden 2xl:inline">
                {props.publishing ? "Publishing" : "Publish to Notion"}
              </span>
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant={inspector === "backlinks" ? "secondary" : "ghost"}
            className="h-8 gap-1.5"
            onClick={() =>
              setInspector((current) => (current === "backlinks" ? null : "backlinks"))
            }
          >
            <Link2 size={14} />
            <span className="hidden xl:inline">Backlinks</span>
            {note.backlinkCount ? (
              <span className="rounded-full bg-charcoal-active px-1.5 text-[10px]">
                {note.backlinkCount}
              </span>
            ) : null}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={inspector === "agent" ? "secondary" : "ghost"}
            className="h-8 gap-1.5"
            onClick={() => setInspector((current) => (current === "agent" ? null : "agent"))}
          >
            <Sparkles size={14} />
            <span>Agent</span>
          </Button>
        </div>
      </header>

      <div
        className={cn(
          "grid min-h-0 overflow-hidden",
          inspector ? "grid-cols-[minmax(0,1fr)_minmax(300px,380px)]" : "grid-cols-1",
        )}
      >
        <div className="misty-scrollbar min-h-0 overflow-auto overscroll-contain">
          <Suspense
            fallback={
              <div className="p-8">
                <Skeleton className="h-[420px] w-full" />
              </div>
            }
          >
            <NoteBlockEditor
              key={note.id}
              editable={editable}
              collaborative={collaborative}
              autoFocus={collaborative}
              noteId={note.sourceId}
              accountId={props.accountId}
              spaceId={note.spaceId}
              body={note.body}
              bodyFormat={note.bodyFormat}
              bodyMarkdown={note.bodyMarkdown}
              linkableNotes={linkableNotes}
              onOpenNote={props.onSelectNote}
              aiContext={{
                kind: note.source === "misty" ? "note" : "provider-note",
                id: note.sourceId,
                title: note.title,
                spaceId: note.spaceId,
                revision: note.collaborationRevision,
                privacy: note.source === "misty" ? "shared" : "provider",
              }}
              onContentChange={
                !collaborative && props.onSaveContent
                  ? (content) => props.onSaveContent?.(note.id, content)
                  : undefined
              }
            />
          </Suspense>
        </div>
        {inspector ? (
          <JournalInspector
            mode={inspector}
            note={note}
            onClose={() => setInspector(null)}
            onSelectNote={props.onSelectNote}
          />
        ) : null}
      </div>
    </article>
  );
}

function CollaborativeTitleInput(props: { spaceId: string; noteId: string; initialTitle: string }) {
  const { session } = useNoteCollaborationRoom(props.spaceId, props.noteId);
  const [title, setTitle] = useState(props.initialTitle);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!session) return;
    if (!session.title.length && props.initialTitle)
      replaceYText(session.title, props.initialTitle);
    const sync = () => setTitle(session.title.toString() || props.initialTitle);
    sync();
    session.title.observe(sync);
    return () => session.title.unobserve(sync);
  }, [props.initialTitle, session]);
  useEffect(() => {
    const focusTitle = (event: Event) => {
      if ((event as CustomEvent<{ noteId?: string }>).detail?.noteId !== props.noteId) return;
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    window.addEventListener("misty:journal-rename-note", focusTitle);
    return () => window.removeEventListener("misty:journal-rename-note", focusTitle);
  }, [props.noteId]);
  return (
    <input
      ref={inputRef}
      className={cn(
        "block h-6 w-full min-w-0 border-0 bg-transparent p-0 text-[15px] font-semibold",
        "leading-tight text-cream-bright outline-none placeholder:text-cream-muted",
      )}
      value={title}
      maxLength={500}
      aria-label="Note title"
      onChange={(event) => {
        setTitle(event.target.value);
        if (session) replaceYText(session.title, event.target.value);
      }}
      onBlur={() => {
        if (!title.trim() && session) replaceYText(session.title, "Untitled note");
      }}
    />
  );
}

function JournalInspector(props: {
  mode: "backlinks" | "agent";
  note: UnifiedNote;
  onClose: () => void;
  onSelectNote?: (noteId: string) => void;
}) {
  return (
    <aside className="flex min-h-0 flex-col border-l border-charcoal-border bg-charcoal-sidebar/55">
      {props.mode === "backlinks" ? (
        <BacklinksInspector
          note={props.note}
          onClose={props.onClose}
          onSelectNote={props.onSelectNote}
        />
      ) : (
        <AgentInspector note={props.note} onClose={props.onClose} />
      )}
    </aside>
  );
}

function InspectorHeader(props: {
  title: string;
  icon: React.ReactNode;
  onClose: () => void;
  children?: React.ReactNode;
}) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-charcoal-border px-3">
      <span className="text-cream-muted">{props.icon}</span>
      <h2 className="m-0 flex-1 text-sm font-semibold text-cream-bright">{props.title}</h2>
      {props.children}
      <Button
        size="icon"
        variant="ghost"
        className="size-8"
        aria-label={`Close ${props.title}`}
        onClick={props.onClose}
      >
        <PanelRightClose size={16} />
      </Button>
    </header>
  );
}

function BacklinksInspector(props: {
  note: UnifiedNote;
  onClose: () => void;
  onSelectNote?: (noteId: string) => void;
}) {
  const [links, setLinks] = useState<Array<{ id: string; title: string }>>([]);
  const [loading, setLoading] = useState(props.note.source === "misty");
  useEffect(() => {
    let active = true;
    if (props.note.source !== "misty" || !props.note.spaceId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    notesApi
      .backlinks(props.note.spaceId, props.note.sourceId)
      .then((result) => {
        if (active) setLinks(result.backlinks);
      })
      .catch(() => {
        if (active) setLinks([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [props.note.source, props.note.sourceId, props.note.spaceId]);
  return (
    <>
      <InspectorHeader title="Backlinks" icon={<Link2 size={16} />} onClose={props.onClose} />
      <div className="misty-scrollbar min-h-0 flex-1 overflow-auto p-3">
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-4/5" />
          </div>
        ) : links.length ? (
          <div className="grid gap-1">
            {links.map((backlink) => (
              <button
                key={backlink.id}
                type="button"
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-cream hover:bg-charcoal-active"
                onClick={() => props.onSelectNote?.(`misty:${backlink.id}`)}
              >
                <FileText size={15} />
                <span className="min-w-0 flex-1 truncate">{backlink.title}</span>
                <ChevronRight size={14} />
              </button>
            ))}
          </div>
        ) : (
          <div className="grid place-items-center px-5 py-16 text-center">
            <Link2 className="mb-3 text-cream-muted" size={24} />
            <p className="m-0 text-sm font-medium text-cream">No backlinks yet</p>
            <p className="mb-0 mt-1 text-xs text-cream-muted">
              Type [[ in another note to link here.
            </p>
          </div>
        )}
      </div>
    </>
  );
}

function AgentInspector(props: { note: UnifiedNote; onClose: () => void }) {
  const { agents, loaded, load } = usePersonalAgentsStore(
    useShallow((state) => ({
      agents: state.agents.filter((agent) => agent.enabled),
      loaded: state.loaded,
      load: state.load,
    })),
  );
  const spaces = useSpacesStore((state) => state.spaces);
  const storageKey = `misty:journal-agent:${props.note.spaceId ?? "default"}`;
  const [agentId, setAgentId] = useState(() => localStorage.getItem(storageKey) ?? "");
  useEffect(() => {
    if (!loaded) void load();
  }, [load, loaded]);
  useEffect(() => {
    if (!agents.some((agent) => agent.id === agentId)) setAgentId(agents[0]?.id ?? "");
  }, [agentId, agents]);
  useEffect(() => {
    if (agentId) localStorage.setItem(storageKey, agentId);
  }, [agentId, storageKey]);
  const agent = useMemo(
    () => agents.find((candidate) => candidate.id === agentId),
    [agentId, agents],
  );
  return (
    <AgentInspectorConversation
      key={agent?.id ?? "empty"}
      note={props.note}
      agent={agent}
      agents={agents}
      spaces={spaces}
      agentId={agentId}
      onAgentChange={setAgentId}
      onClose={props.onClose}
    />
  );
}

function AgentInspectorConversation(props: {
  note: UnifiedNote;
  agent?: ReturnType<typeof usePersonalAgentsStore.getState>["agents"][number];
  agents: ReturnType<typeof usePersonalAgentsStore.getState>["agents"];
  spaces: ReturnType<typeof useSpacesStore.getState>["spaces"];
  agentId: string;
  onAgentChange: (id: string) => void;
  onClose: () => void;
}) {
  const activity = useAgentActivity(props.agent?.id ?? "");
  if (!props.agent || !props.note.spaceId)
    return (
      <>
        <InspectorHeader title="Agent" icon={<Bot size={16} />} onClose={props.onClose} />
        <div className="grid flex-1 place-items-center p-6 text-center text-sm text-cream-muted">
          Create or enable an Agent to work with this note.
        </div>
      </>
    );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <InspectorHeader
        title="Agent"
        icon={
          <AgentAvatar
            agentId={props.agent.id}
            avatar={props.agent.avatar}
            legacyIcon={props.agent.icon}
            name={props.agent.name}
            className="size-6"
          />
        }
        onClose={props.onClose}
      >
        <Select value={props.agentId} onValueChange={props.onAgentChange}>
          <SelectTrigger className="h-8 w-36 border-charcoal-border bg-charcoal-card text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {props.agents.map((agent) => (
              <SelectItem key={agent.id} value={agent.id}>
                {agent.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </InspectorHeader>
      <AgentConversationPanel
        agent={props.agent}
        spaceId={props.note.spaceId}
        spaces={props.spaces}
        onSpaceChange={() => undefined}
        onEdit={() => undefined}
        controller={activity}
        compact
        contextNoteId={props.note.sourceId}
      />
    </div>
  );
}

function replaceYText(text: YText, value: string) {
  if (text.toString() === value) return;
  text.doc?.transact(() => {
    text.delete(0, text.length);
    text.insert(0, value);
  }, "misty-title");
}
function ReadingPaneSkeleton() {
  return (
    <div className={paneClass} aria-hidden="true">
      <div className={headerClass}>
        <Skeleton className="size-8" />
        <div className="flex-1">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="mt-2 h-3 w-1/4" />
        </div>
      </div>
      <div className="space-y-3 p-10">
        {[0, 1, 2, 3, 4].map((row) => (
          <Skeleton key={row} className={row % 3 === 2 ? "h-3 w-3/5" : "h-3 w-full"} />
        ))}
      </div>
    </div>
  );
}

export interface NoteContentDraft {
  body: string;
  bodyFormat: NoteBodyFormat;
  bodyMarkdown?: string;
}
export interface NoteReadingPaneProps {
  note?: UnifiedNote;
  hasNotes?: boolean;
  accountId?: string;
  loading: boolean;
  editingNoteId?: string;
  referenceOnly?: boolean;
  onEditingNoteChange?: (noteId: string | undefined) => void;
  onSaveBody?: (noteId: string, body: string) => void;
  onSaveContent?: (noteId: string, content: NoteContentDraft) => void;
  onDelete?: (noteId: string) => Promise<void>;
  onNewNote: () => void;
  onOpenInSource?: (noteId: string) => void;
  onPublish?: (noteId: string) => void;
  publishing?: boolean;
  publishError?: string;
  linkableNotes?: UnifiedNote[];
  onSelectNote?: (noteId: string) => void;
}
export interface NoteConflictNoticeProps {
  note: UnifiedNote;
}
