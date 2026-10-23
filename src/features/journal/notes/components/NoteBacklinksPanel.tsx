import { IconButton, Pressable, Skeleton } from "@/shared/ui";
import { ChevronRight, FileText, Link2, PanelRightClose } from "lucide-react";
import { useEffect, useState } from "react";
import type { UnifiedNote } from "../model/types";
import type { NoteReadingRuntime } from "./NoteReadingPaneView";

/** The side panel beside a note: the notes that link to it. */
export function NoteBacklinksPanel(props: {
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
      <IconButton label={`Close ${props.title}`} onClick={props.onClose}>
        <PanelRightClose size={16} />
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
  const [links, setLinks] = useState<
    Array<{
      id: string;
      title: string;
    }>
  >([]);
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
              <Pressable
                key={backlink.id}
                className="flex items-center hover:bg-cream/[0.045] rounded-lg px-3 py-2 text-cream"
                onClick={() => props.onSelectNote?.(`misty:${backlink.id}`)}
              >
                <FileText size={15} />
                <span className="min-w-0 flex-1 truncate">{backlink.title}</span>
                <ChevronRight size={14} />
              </Pressable>
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
