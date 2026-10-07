import { Code2, FileText, Image as ImageIcon, NotebookText, PenLine } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { LibraryItemThumbnail } from "@/features/library";
import { cn, itemToneClass, itemTones, Pressable, type ItemTone } from "@/shared/ui";
import { editedLabel, type GalleryItem, type GalleryKind } from "./galleryItems";

type KindIcon = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
const kindIcon: Record<GalleryKind, { Icon: KindIcon; tone: ItemTone; label: string }> = {
  note: { Icon: NotebookText, tone: itemTones.note, label: "Note" },
  drawing: { Icon: PenLine, tone: itemTones.drawing, label: "Drawing" },
  image: { Icon: ImageIcon, tone: itemTones.image, label: "Image" },
  file: { Icon: FileText, tone: itemTones.document, label: "File" },
  code: { Icon: Code2, tone: itemTones.code, label: "Code project" },
};

/** The item's kind as a toned glyph; the tile around it stays monochrome. */
export function GalleryKindIcon({ kind, className }: { kind: GalleryKind; className?: string }) {
  const { Icon, tone } = kindIcon[kind];
  return <Icon aria-hidden className={cn("size-4", itemToneClass(tone), className)} />;
}

function Preview({ item, spaceId }: { item: GalleryItem; spaceId: string }): ReactNode {
  if (item.libraryItem) return <LibraryItemThumbnail spaceId={spaceId} item={item.libraryItem} />;
  if (item.kind === "note")
    return (
      <div className="h-full p-3">
        <p className="m-0 mb-1.5 truncate font-serif text-base text-cream-bright">{item.title}</p>
        <p className="m-0 line-clamp-4 text-xs leading-relaxed text-cream-muted">
          {item.excerpt || "Empty note"}
        </p>
      </div>
    );
  if (item.kind === "code")
    return (
      <div className="flex h-full flex-col justify-center gap-1 p-3 font-mono text-xs text-cream-muted">
        <span className="truncate text-cream">{item.repo || "Not on GitHub yet"}</span>
        <span>Files stay on the owner's computer</span>
      </div>
    );
  return (
    <div className="grid h-full place-items-center" aria-hidden>
      <GalleryKindIcon kind={item.kind} className="size-8 opacity-80" />
    </div>
  );
}

/** One item as a card with a live preview, or as a list row. */
export function GalleryCard(props: {
  item: GalleryItem;
  spaceId: string;
  maker: string;
  view: "grid" | "list";
  onOpen: (item: GalleryItem) => void;
}) {
  const { item, view } = props;
  const { label } = kindIcon[item.kind];
  const meta = [props.maker, editedLabel(item.updatedAt)].filter(Boolean).join(" · ");
  if (view === "list")
    return (
      <Pressable
        onClick={() => props.onOpen(item)}
        className={cn(
          "flex w-full items-center gap-3 border-b border-charcoal-border px-1 py-2.5",
          "hover:bg-charcoal-card/60",
        )}
      >
        <span className="grid size-7 shrink-0 place-items-center rounded-md bg-charcoal-card">
          <GalleryKindIcon kind={item.kind} />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-cream-bright">{item.title}</span>
        <span className="shrink-0 text-xs text-cream-muted">{label}</span>
        <span className="w-44 shrink-0 truncate text-right text-xs text-cream-muted">{meta}</span>
      </Pressable>
    );
  return (
    <Pressable
      onClick={() => props.onOpen(item)}
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded-xl border border-charcoal-border",
        "bg-charcoal-card hover:border-cream-muted/40",
      )}
      aria-label={`${label}: ${item.title}`}
    >
      <div className="relative h-32 overflow-visible bg-charcoal-workspace">
        <div className="h-full overflow-hidden">
          <Preview item={item} spaceId={props.spaceId} />
        </div>
        <span
          className={cn(
            "absolute -bottom-3.5 left-3 grid size-7 place-items-center rounded-lg",
            "border border-charcoal-border bg-charcoal-card",
          )}
        >
          <GalleryKindIcon kind={item.kind} />
        </span>
      </div>
      <div className="px-3 pb-3 pt-5">
        <p className="m-0 truncate text-sm text-cream-bright">{item.title}</p>
        <p className="m-0 mt-1 truncate text-xs text-cream-muted">{meta}</p>
      </div>
    </Pressable>
  );
}
