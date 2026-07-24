import type {
  ContextSectionProps,
  NoteContextPanelProps,
} from "@/models/interfaces/features/notes/components/NoteContextPanel";
export type {
  ContextSectionProps,
  NoteContextPanelProps,
} from "@/models/interfaces/features/notes/components/NoteContextPanel";
import type { ReactNode } from "react";
import { Link2 } from "lucide-react";
import { Badge, ScrollArea } from "@/ui";
import { relativeTime } from "@/features/notes/noteFilters";

const panelClass =
  "grid h-full min-h-0 grid-rows-[minmax(0,1fr)] border-l border-border bg-card/40";

export function NoteContextPanel(props: NoteContextPanelProps) {
  const { note } = props;

  if (!note) {
    return (
      <aside className={panelClass} aria-label="Note details">
        <div className="grid place-items-center px-4 text-center">
          <p className="text-[12px] text-muted-foreground">Select a note to see its details.</p>
        </div>
      </aside>
    );
  }

  return (
    <aside className={panelClass} aria-label="Note details">
      <ScrollArea className="min-h-0">
        <div className="px-3.5 pb-6">
          <ContextSection title="Space">
            <p className="m-0 text-[12px] text-foreground/90">{note.spaceName}</p>
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
    <section className="border-b border-border/60 py-3.5 last:border-b-0">
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70">
        {props.title}
      </h3>
      {props.children}
    </section>
  );
}

function Row(props: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="shrink-0 text-muted-foreground/70">{props.label}</dt>
      <dd className="min-w-0 truncate text-right text-foreground/90">{props.value}</dd>
    </div>
  );
}

function ContextList(props: { icon: typeof Link2; items: string[] }) {
  const Icon = props.icon;
  return (
    <ul className="space-y-1">
      {props.items.map((item) => (
        <li key={item} className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
          <Icon size={11} strokeWidth={1.9} className="shrink-0 text-muted-foreground/60" />
          <span className="min-w-0 truncate">{item}</span>
        </li>
      ))}
    </ul>
  );
}
