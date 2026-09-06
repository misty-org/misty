import type { NativeNotesApi } from "../noteServices";
import type { NoteBlockEditorProps, NoteEditorRuntime } from "./NoteBlockEditorView";
import { Button, EmptyState, Skeleton, cn } from "@/shared/ui";
import { ChevronLeft, ChevronRight, FileText, Link2, PanelRightClose } from "lucide-react";
import { Suspense, useEffect, useRef, useState, type ComponentType } from "react";
import type { Text as YText } from "yjs";
import type { NoteBodyFormat, UnifiedNote } from "../model/types/types";

export interface NoteReadingRuntime {
  useCollaborationRoom: NoteEditorRuntime["useCollaborationRoom"];
  backlinks: NativeNotesApi["backlinks"];
  subscribeRename(noteId: string, focus: () => void): () => void;
  Editor: ComponentType<Omit<NoteBlockEditorProps, "runtime">>;
}
const paneClass = "grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-charcoal-bg";
const headerClass =
  "flex min-h-11 shrink-0 items-center gap-2 border-b border-charcoal-border bg-charcoal-bg py-1.5 pl-1 pr-3";

export function NoteReadingPaneView(props: NoteReadingPaneProps & { runtime: NoteReadingRuntime }) {
  const NoteBlockEditor = props.runtime.Editor;
  const { note } = props;
  const [inspector, setInspector] = useState<"backlinks" | null>(null);
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
      <header className={cn(headerClass, props.mobile && "min-h-14 px-3")}>
        {props.onBack ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 px-2 text-cream-muted hover:text-cream-bright"
            onClick={props.onBack}
            aria-label="Back to notes"
          >
            <ChevronLeft size={16} />
            <span className="text-xs font-medium">Notes</span>
          </Button>
        ) : null}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {collaborative && note.spaceId ? (
            <CollaborativeTitleInput
              runtime={props.runtime}
              spaceId={note.spaceId}
              noteId={note.sourceId}
              initialTitle={note.title}
              mobile={props.mobile}
            />
          ) : (
            <h1 className="m-0 truncate text-sm font-semibold text-cream-bright">{note.title}</h1>
          )}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant={inspector === "backlinks" ? "secondary" : "ghost"}
            className={cn("gap-1.5", props.mobile ? "h-11" : "h-8")}
            aria-label="Backlinks"
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
        </div>
      </header>

      <div
        className={cn(
          "grid min-h-0 overflow-hidden",
          inspector && !props.mobile
            ? "grid-cols-[minmax(0,1fr)_minmax(300px,380px)]"
            : "grid-cols-1",
        )}
      >
        <div
          className={cn(
            "misty-scrollbar min-h-0 overflow-auto overscroll-contain",
            props.mobile && inspector && "hidden",
          )}
        >
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
            runtime={props.runtime}
            note={note}
            onClose={() => setInspector(null)}
            onSelectNote={props.onSelectNote}
          />
        ) : null}
      </div>
    </article>
  );
}

function CollaborativeTitleInput(props: {
  runtime: NoteReadingRuntime;
  spaceId: string;
  noteId: string;
  initialTitle: string;
  mobile?: boolean;
}) {
  const { session } = props.runtime.useCollaborationRoom(props.spaceId, props.noteId);
  const [title, setTitle] = useState(props.initialTitle);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!session) return;
    let initialized = false;
    const sync = () => {
      if (!initialized && session.provider.synced) {
        initialized = true;
        if (
          session.provider.synced &&
          session.role !== "viewer" &&
          !session.title.length &&
          props.initialTitle
        )
          replaceYText(session.title, props.initialTitle);
      }
      setTitle(session.title.toString() || props.initialTitle);
    };
    sync();
    session.title.observe(sync);
    session.provider.on("sync", sync);
    return () => {
      session.title.unobserve(sync);
      session.provider.off("sync", sync);
    };
  }, [props.initialTitle, session]);
  useEffect(
    () =>
      props.runtime.subscribeRename(props.noteId, () => {
        if (session?.role === "viewer") return;
        inputRef.current?.focus();
        inputRef.current?.select();
      }),
    [props.noteId, props.runtime, session?.role],
  );
  return (
    <input
      ref={inputRef}
      className={cn(
        "block w-full max-w-md min-w-0 rounded-md border border-charcoal-active bg-charcoal-card px-2 text-sm font-semibold",
        props.mobile ? "h-11 text-base" : "h-8",
        "text-cream-bright shadow-none outline-none placeholder:text-cream-muted",
        "focus-visible:border-sage-fg/70 focus-visible:ring-2 focus-visible:ring-sage-fg/15",
      )}
      value={title}
      maxLength={500}
      aria-label="Note title"
      readOnly={!session || session.role === "viewer"}
      onChange={(event) => {
        setTitle(event.target.value);
        if (session && session.role !== "viewer") replaceYText(session.title, event.target.value);
      }}
      onBlur={() => {
        if (!title.trim() && session && session.role !== "viewer")
          replaceYText(session.title, "Untitled note");
      }}
    />
  );
}

function JournalInspector(props: {
  runtime: NoteReadingRuntime;
  note: UnifiedNote;
  onClose: () => void;
  onSelectNote?: (noteId: string) => void;
}) {
  return (
    <aside className="flex min-h-0 flex-col border-l border-charcoal-border bg-charcoal-sidebar/55">
      <BacklinksInspector
        runtime={props.runtime}
        note={props.note}
        onClose={props.onClose}
        onSelectNote={props.onSelectNote}
      />
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
  runtime: NoteReadingRuntime;
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
    props.runtime
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
  }, [props.note.source, props.note.sourceId, props.note.spaceId, props.runtime]);
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
  onBack?: () => void;
  onEditingNoteChange?: (noteId: string | undefined) => void;
  onSaveBody?: (noteId: string, body: string) => void;
  onSaveContent?: (noteId: string, content: NoteContentDraft) => void;
  onDelete?: (noteId: string) => Promise<void>;
  onNewNote: () => void;
  linkableNotes?: UnifiedNote[];
  onSelectNote?: (noteId: string) => void;
  mobile?: boolean;
}
export interface NoteConflictNoticeProps {
  note: UnifiedNote;
}
