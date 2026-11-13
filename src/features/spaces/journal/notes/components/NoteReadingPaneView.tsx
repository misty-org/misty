import { BackButton, Badge, Button, cn, EmptyState, Skeleton, Surface, Text } from "@/shared/ui";
import { Link2 } from "lucide-react";
import { Suspense, useEffect, useState, type ComponentType } from "react";
import type { UnifiedNote } from "../noteTypes";
import type { NativeNotesApi } from "../noteServices";
import type { NoteBlockEditorProps, NoteEditorRuntime } from "./NoteBlockEditorView";
import { NoteBacklinksPanel } from "./NoteBacklinksPanel";
import { NoteDocumentSkeleton } from "./NoteDocumentSkeleton";
import { NoteTitleInput } from "./NoteTitleInput";
export interface NoteReadingRuntime {
  useCollaborationRoom: NoteEditorRuntime["useCollaborationRoom"];
  backlinks: NativeNotesApi["backlinks"];
  subscribeRename(noteId: string, focus: () => void): () => void;
  Editor: ComponentType<Omit<NoteBlockEditorProps, "runtime">>;
}
const paneClass = "grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]";
const headerClass = "flex min-h-12 shrink-0 items-center gap-2 border-b py-1.5 pl-1 pr-3";
export function NoteReadingPaneView(
  props: NoteReadingPaneProps & {
    runtime: NoteReadingRuntime;
  },
) {
  const NoteBlockEditor = props.runtime.Editor;
  const { note } = props;
  const [inspector, setInspector] = useState<"backlinks" | null>(null);
  useEffect(() => setInspector(null), [note?.id]);
  if (props.loading) return <ReadingPaneSkeleton editable={!props.referenceOnly} />;
  if (!note) {
    return (
      <Surface tone="page" className={paneClass}>
        <div className="row-span-2 grid place-items-center">
          <EmptyState
            inline
            title={props.hasNotes ? "Select a doc" : "No docs yet"}
            line={
              props.hasNotes
                ? "Choose a doc from the list to open it."
                : "Create a doc to keep this Space's work close by."
            }
            action={props.hasNotes ? undefined : { label: "New doc", onClick: props.onNewNote }}
          />
        </div>
      </Surface>
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
    <Surface as="article" tone="page" className={paneClass} aria-label={note.title}>
      <Surface as="header" tone="page" className={headerClass}>
        {props.onBack ? <BackButton onClick={props.onBack} aria-label="Back to docs" /> : null}
        <div className="flex min-w-0 flex-1 items-center gap-2" data-tour="doc-title">
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
            <Text as="h1" full tone="bright" className="m-0 text-sm font-semibold">
              {note.title}
            </Text>
          )}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            type="button"
            variant={inspector === "backlinks" ? "secondary" : "quiet"}
            aria-label="Backlinks"
            data-tour="doc-backlinks"
            onClick={() =>
              setInspector((current) => (current === "backlinks" ? null : "backlinks"))
            }
          >
            <Link2 />
            <span className="hidden xl:inline">Backlinks</span>
            {note.backlinkCount ? <Badge variant="count">{note.backlinkCount}</Badge> : null}
          </Button>
        </div>
      </Surface>

      <div
        className={cn(
          "grid min-h-0 overflow-hidden",
          inspector ? "grid-cols-[minmax(0,1fr)_minmax(300px,380px)]" : "grid-cols-1",
        )}
      >
        <div className={cn("misty-scrollbar min-h-0 overflow-auto overscroll-contain", false)}>
          <Suspense fallback={<NoteDocumentSkeleton label="Opening doc" toolbar={collaborative} />}>
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
    </Surface>
  );
}
/** The pane while its docs first load: the title bar with its Backlinks button, then the doc. */
function ReadingPaneSkeleton({ editable }: { editable: boolean }) {
  return (
    <Surface tone="page" className={paneClass} aria-hidden="true">
      <Surface tone="page" className={headerClass}>
        <div className="flex min-w-0 flex-1 items-center px-2">
          <Skeleton className="h-3.5 w-1/3" />
        </div>
        <Skeleton className="ml-auto h-8 w-8 rounded-md xl:w-28" />
      </Surface>
      <div className="min-h-0 overflow-hidden">
        <NoteDocumentSkeleton label="Opening doc" toolbar={editable} />
      </div>
    </Surface>
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
