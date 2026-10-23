import { Button, cn, EmptyState, Skeleton, SkeletonDocument } from "@/shared/ui";
import { ChevronLeft, Link2 } from "lucide-react";
import { Suspense, useEffect, useState, type ComponentType } from "react";
import type { UnifiedNote } from "../model/types";
import type { NativeNotesApi } from "../noteServices";
import type { NoteBlockEditorProps, NoteEditorRuntime } from "./NoteBlockEditorView";
import { NoteBacklinksPanel } from "./NoteBacklinksPanel";
import { NoteTitleInput } from "./NoteTitleInput";
export interface NoteReadingRuntime {
  useCollaborationRoom: NoteEditorRuntime["useCollaborationRoom"];
  backlinks: NativeNotesApi["backlinks"];
  subscribeRename(noteId: string, focus: () => void): () => void;
  Editor: ComponentType<Omit<NoteBlockEditorProps, "runtime">>;
}
const paneClass = "grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-charcoal-bg";
const headerClass =
  "flex min-h-11 shrink-0 items-center gap-2 border-b border-charcoal-border bg-charcoal-bg py-1.5 pl-1 pr-3";
export function NoteReadingPaneView(
  props: NoteReadingPaneProps & {
    runtime: NoteReadingRuntime;
  },
) {
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
  const linkableNotes = (props.linkableNotes ?? [])
    .filter((candidate) => candidate.id !== note.id && candidate.source === "misty")
    .map((candidate) => ({
      id: candidate.sourceId,
      title: candidate.title,
    }));
  return (
    <article className={paneClass} aria-label={note.title}>
      <header className={cn(headerClass, false)}>
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
            <NoteTitleInput
              runtime={props.runtime}
              spaceId={note.spaceId}
              noteId={note.sourceId}
              initialTitle={note.title}
              renameRequested={props.renameRequested}
              onRenameHandled={props.onRenameHandled}
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
            className={cn("gap-1.5", "h-8")}
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
          inspector ? "grid-cols-[minmax(0,1fr)_minmax(300px,380px)]" : "grid-cols-1",
        )}
      >
        <div className={cn("misty-scrollbar min-h-0 overflow-auto overscroll-contain", false)}>
          <Suspense fallback={<SkeletonDocument label="Opening note" />}>
            <NoteBlockEditor
              key={note.id}
              editable={collaborative}
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
            />
          </Suspense>
        </div>
        {inspector ? (
          <NoteBacklinksPanel
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
export interface NoteReadingPaneProps {
  renameRequested?: boolean;
  onRenameHandled?: () => void;
  note?: UnifiedNote;
  hasNotes?: boolean;
  accountId?: string;
  loading: boolean;
  referenceOnly?: boolean;
  onBack?: () => void;
  onNewNote: () => void;
  linkableNotes?: UnifiedNote[];
  onSelectNote?: (noteId: string) => void;
}
