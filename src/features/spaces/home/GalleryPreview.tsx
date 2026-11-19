import { FileText, FlaskConical, Image as ImageIcon, MessagesSquare } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { LibraryItemThumbnail } from "../library";
import {
  itemTones,
  spaceMadeKind,
  Surface,
  Text,
  type ItemTone,
  type SpaceMadeKind,
} from "@/shared/ui";
import type { GalleryItem, GalleryKind } from "./galleryItems";

type KindIcon = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
const made = (kind: SpaceMadeKind) => {
  const { icon, tone, label } = spaceMadeKind(kind);
  return { Icon: icon, tone, label };
};
export const kindIcon: Record<GalleryKind, { Icon: KindIcon; tone: ItemTone; label: string }> = {
  chat: { Icon: MessagesSquare, tone: itemTones.chat, label: "Chat" },
  note: made("note"),
  deck: made("deck"),
  workbook: made("workbook"),
  drawing: made("drawing"),
  image: { Icon: ImageIcon, tone: itemTones.image, label: "Image" },
  file: { Icon: FileText, tone: itemTones.document, label: "File" },
};

/** An item's glyph and kind: a Lab notebook's doc reads as a notebook, not a doc. */
export function itemIcon(item: Pick<GalleryItem, "kind" | "notebook">) {
  return item.notebook
    ? { Icon: FlaskConical, tone: itemTones.note, label: "Notebook" }
    : kindIcon[item.kind];
}

/** What a card shows instead of an icon: the item itself, as far as it can be drawn. */
export function GalleryPreview({
  item,
  spaceId,
}: {
  item: GalleryItem;
  spaceId: string;
}): ReactNode {
  if (item.libraryItem) return <LibraryItemThumbnail spaceId={spaceId} item={item.libraryItem} />;
  if (item.kind === "note" || ((item.kind === "deck" || item.kind === "workbook") && item.excerpt))
    return (
      <div className="h-full p-3">
        <Text as="p" tone="muted" lines={4} className="m-0 text-xs leading-relaxed">
          {item.excerpt || "Empty doc"}
        </Text>
      </div>
    );
  // A chat's preview stays quiet until the list carries its latest message.
  if (item.kind === "chat") return <div className="h-full" />;
  // Whiteboards, and decks and workbooks with no words yet, have no saved snapshot; a blank
  // page stands in for one.
  return <Surface tone="page" className="h-full" />;
}
