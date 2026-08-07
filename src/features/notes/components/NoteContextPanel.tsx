import type { UnifiedNote } from "@/models/types/features/notes/types";
import type { ReactNode } from "react";
import { Link2 } from "lucide-react";
import { Badge, ScrollArea } from "@/ui";
import { relativeTime } from "@/features/notes/noteFilters";

const panelClass =
  "grid h-full min-h-0 grid-rows-[minmax(0,1fr)] border-l border-charcoal-border bg-charcoal-card";

export function NoteContextPanel(props: NoteContextPanelProps) {
  const { note } = props;

  if (!note) {
    return (
      <aside className={panelClass} aria-label="Note details">
        <div className="grid place-items-center px-4 text-center">
          <p className="text-[12px] text-cream-muted">Select a note to see its details.</p>
        </div>
      </aside>
    );
  }

  return (
    <aside className={panelClass} aria-label="Note details">
      <ScrollArea className="min-h-0">
        <div className="px-3.5 pb-6">
          <ContextSection title="Space">
            <p className="m-0 text-[12px] text-cream/90">{note.spaceName}</p>
          </ContextSection>

          <ContextSection title="Details">
            <dl className="space-y-1.5 text-[11px]">
              <Row label="Updated" value={relativeTime(note.updatedAt)} />
              <Row label="Created" value={relativeTime(note.createdAt)} />
            </dl>
          </ContextSection>

          {note.tags.length ? (
            <ContextSection title="Tags">
              <div className="flex flex-wrap gap-1">
                {note.tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-[10px] font-normal">
                    {tag}
                  </Badge>
                ))}
              </div>
            </ContextSection>
          ) : null}

          {note.backlinks.length ? (
            <ContextSection title="Backlinks">
              <ContextList icon={Link2} items={note.backlinks} />
            </ContextSection>
          ) : null}
        </div>
      </ScrollArea>
    </aside>
  );
}

function ContextSection(props: ContextSectionProps) {
  return (
    <section className="border-b border-charcoal-border/60 py-3.5 last:border-b-0">
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-cream-muted/70">
        {props.title}
      </h3>
      {props.children}
    </section>
  );
}

function Row(props: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="shrink-0 text-cream-muted/70">{props.label}</dt>
      <dd className="min-w-0 truncate text-right text-cream/90">{props.value}</dd>
    </div>
  );
}

function ContextList(props: { icon: typeof Link2; items: string[] }) {
  const Icon = props.icon;
  return (
    <ul className="space-y-1">
      {props.items.map((item) => (
        <li key={item} className="flex items-center gap-1.5 text-[11.5px] text-cream-muted">
          <Icon size={11} strokeWidth={1.9} className="shrink-0 text-cream-muted/60" />
          <span className="min-w-0 truncate">{item}</span>
        </li>
      ))}
    </ul>
  );
}

export interface NoteContextPanelProps {
  note?: UnifiedNote;
}

export interface ContextSectionProps {
  title: string;
  children: ReactNode;
}
