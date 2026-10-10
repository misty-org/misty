import {
  Code2,
  FileText,
  Image as ImageIcon,
  MessagesSquare,
  NotebookText,
  PenLine,
} from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { LibraryItemThumbnail } from "@/features/library";
import { cn, itemToneClass, itemTones, Pressable, type ItemTone } from "@/shared/ui";
import type { ItemVisibility } from "@/api/spaces/visibility";
import { editedLabel, type GalleryItem, type GalleryKind } from "./galleryItems";
import { PrivateLabel, VisibilityMenu } from "../components/VisibilityMenu";

type KindIcon = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
const kindIcon: Record<GalleryKind, { Icon: KindIcon; tone: ItemTone; label: string }> = {
  chat: { Icon: MessagesSquare, tone: itemTones.chat, label: "Chat" },
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
  if (item.kind === "chat")
    return (
      <div className="flex h-full flex-col justify-end gap-1.5 p-3">
        <span className="w-fit max-w-full truncate rounded-lg bg-charcoal-card px-2.5 py-1.5 text-xs text-cream-muted">
          {item.people?.length ? `With ${item.people.join(", ")}` : "Just you so far"}
        </span>
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

type GalleryCardProps = {
  item: GalleryItem;
  spaceId: string;
  maker: string;
  view: "grid" | "list";
  onOpen: (item: GalleryItem) => void;
  /** Set when the viewer owns the item: its menu carries the Private toggle. */
  onVisibilityChange?: (item: GalleryItem, visibility: ItemVisibility) => void;
};

/** One item as a card with a live preview, or as a list row, with its owner's menu beside it. */
export function GalleryCard(props: GalleryCardProps) {
  const { item, onVisibilityChange } = props;
  const menu =
    item.toggle && onVisibilityChange ? (
      <VisibilityMenu
        label={item.title}
        visibility={item.visibility}
        onChange={(visibility) => onVisibilityChange(item, visibility)}
        className={
          props.view === "list"
            ? "shrink-0"
            : "absolute right-2 top-2 bg-charcoal-card/90 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100"
        }
      />
    ) : null;
  if (props.view === "list")
    return (
      <div className="flex items-center gap-1 border-b border-charcoal-border">
        <GalleryCardBody {...props} />
        {menu}
      </div>
    );
  return (
    <div className="group relative min-w-0">
      <GalleryCardBody {...props} />
      {menu}
    </div>
  );
}

function GalleryCardBody(props: GalleryCardProps) {
  const { item, view } = props;
  const { label } = kindIcon[item.kind];
  const meta = [props.maker, editedLabel(item.updatedAt)].filter(Boolean).join(" · ");
  const isPrivate = item.visibility === "private";
  if (view === "list")
    return (
      <Pressable
        onClick={() => props.onOpen(item)}
        className={cn(
          "flex w-full min-w-0 items-center gap-3 px-1 py-2.5",
          "hover:bg-charcoal-card/60",
        )}
      >
        <span className="grid size-7 shrink-0 place-items-center rounded-md bg-charcoal-card">
          <GalleryKindIcon kind={item.kind} />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-cream-bright">{item.title}</span>
        {isPrivate && <PrivateLabel />}
        <span className="shrink-0 text-xs text-cream-muted">{label}</span>
        <span className="w-44 shrink-0 truncate text-right text-xs text-cream-muted">{meta}</span>
      </Pressable>
    );
  return (
    <Pressable
      onClick={() => props.onOpen(item)}
      className={cn(
        "flex w-full min-w-0 flex-col overflow-hidden rounded-xl border border-charcoal-border text-left",
        "bg-charcoal-card hover:border-cream-muted/40",
      )}
      aria-label={`${label}${isPrivate ? ", private" : ""}: ${item.title}`}
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
        <p className="m-0 mt-1 flex min-w-0 items-center gap-2 text-xs text-cream-muted">
          <span className="min-w-0 truncate">{meta}</span>
          {isPrivate && <PrivateLabel />}
        </p>
      </div>
    </Pressable>
  );
}
