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
import { itemTones, type ItemTone } from "@/shared/ui";
import type { GalleryItem, GalleryKind } from "./galleryItems";

type KindIcon = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
export const kindIcon: Record<GalleryKind, { Icon: KindIcon; tone: ItemTone; label: string }> = {
  chat: { Icon: MessagesSquare, tone: itemTones.chat, label: "Chat" },
  note: { Icon: NotebookText, tone: itemTones.note, label: "Note" },
  drawing: { Icon: PenLine, tone: itemTones.drawing, label: "Drawing" },
  image: { Icon: ImageIcon, tone: itemTones.image, label: "Image" },
  file: { Icon: FileText, tone: itemTones.document, label: "File" },
  code: { Icon: Code2, tone: itemTones.code, label: "Code" },
};

/** What a card shows instead of an icon: the item itself, as far as it can be drawn. */
export function GalleryPreview({
  item,
  spaceId,
}: {
  item: GalleryItem;
  spaceId: string;
}): ReactNode {
  if (item.libraryItem) return <LibraryItemThumbnail spaceId={spaceId} item={item.libraryItem} />;
  if (item.kind === "note")
    return (
      <div className="h-full p-3">
        <p className="m-0 line-clamp-4 text-xs leading-relaxed text-cream-muted">
          {item.excerpt || "Empty note"}
        </p>
      </div>
    );
  // A chat's preview stays quiet until the list carries its latest message.
  if (item.kind === "chat") return <div className="h-full" />;
  if (item.kind === "code")
    return (
      <div className="flex h-full flex-col justify-center gap-1 p-3 font-mono text-xs text-cream-muted">
        <span className="truncate text-cream">{item.repo || "Not on GitHub yet"}</span>
        <span>Files stay on the owner's computer</span>
      </div>
    );
  // Drawings have no saved snapshot yet; a blank canvas stands in for one.
  return <div className="h-full bg-charcoal-workspace" />;
}
