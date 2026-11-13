import { IconButton, PlaceholderIcon, Pressable, Skeleton, Surface, Text } from "@/shared/ui";
import { ChevronRight, FileText, Link2, PanelRightClose } from "lucide-react";
import { useSpaceResource } from "../../../api/spaceResource";
import type { UnifiedNote } from "../noteTypes";
import type { NoteReadingRuntime } from "./NoteReadingPaneView";

const noLinks: { id: string; title: string }[] = [];

/** The side panel beside a note: the notes that link to it. */
export function NoteBacklinksPanel(props: {
  runtime: NoteReadingRuntime;
  note: UnifiedNote;
  onClose: () => void;
  onSelectNote?: (noteId: string) => void;
}) {
  return (
    <Surface as="aside" tone="sidebar" className="flex min-h-0 flex-col border-l">
      <BacklinksInspector
        runtime={props.runtime}
        note={props.note}
        onClose={props.onClose}
        onSelectNote={props.onSelectNote}
      />
    </Surface>
  );
}
function InspectorHeader(props: {
  title: string;
  icon: React.ReactNode;
  onClose: () => void;
  children?: React.ReactNode;
}) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
      <Text bare tone="muted">
        {props.icon}
      </Text>
      <Text bare as="h2" tone="bright" className="m-0 flex-1 text-sm font-semibold">
        {props.title}
      </Text>
      {props.children}
      <IconButton label={`Close ${props.title}`} onClick={props.onClose}>
        <PanelRightClose />
      </IconButton>
    </header>
  );
}
function BacklinksInspector(props: {
  runtime: NoteReadingRuntime;
  note: UnifiedNote;
  onClose: () => void;
  onSelectNote?: (noteId: string) => void;
}) {
  const { note, runtime } = props;
  const spaceId = note.source === "misty" ? (note.spaceId ?? "") : "";
  // The last list paints at once when the panel opens again, and a fresh one loads behind it.
  const backlinks = useSpaceResource(
    spaceId
      ? `/spaces/${encodeURIComponent(spaceId)}/notes/${encodeURIComponent(note.sourceId)}/backlinks`
      : null,
    () => runtime.backlinks(spaceId, note.sourceId).then((result) => result.backlinks),
  );
  const links = backlinks.data ?? noLinks;
  const loading = backlinks.loading;
  return (
    <>
      <InspectorHeader title="Backlinks" icon={<Link2 />} onClose={props.onClose} />
      <div className="misty-scrollbar min-h-0 flex-1 overflow-auto p-3">
        {loading ? (
          <div className="grid gap-1" aria-hidden="true">
            <Skeleton className="h-9 w-full rounded-lg" />
            <Skeleton className="h-9 w-4/5 rounded-lg" />
          </div>
        ) : links.length ? (
          <div className="grid gap-1">
            {links.map((backlink) => (
              <Pressable
                key={backlink.id}
                wash="row"
                className="flex items-center rounded-lg px-3 py-2"
                onClick={() => props.onSelectNote?.(`misty:${backlink.id}`)}
              >
                <FileText />
                <Text tone="default" className="flex-1">
                  {backlink.title}
                </Text>
                <ChevronRight />
              </Pressable>
            ))}
          </div>
        ) : (
          <div className="grid place-items-center px-5 py-16 text-center">
            <PlaceholderIcon icon={Link2} className="mb-3" />
            <Text wrap tone="default" className="m-0 text-sm font-medium">
              No backlinks yet
            </Text>
            <Text wrap tone="muted" className="mb-0 mt-1 text-xs">
              Type [[ in another doc to link here.
            </Text>
          </div>
        )}
      </div>
    </>
  );
}
