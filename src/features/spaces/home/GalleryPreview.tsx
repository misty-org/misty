import { FileText, Image as ImageIcon, MessagesSquare } from "lucide-react";
import type { ComponentType } from "react";
import { itemTones, type ItemTone } from "@misty/ui";
import type { GalleryKind } from "./galleryItems";

type KindIcon = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

/** Each kind's glyph, tone and name, wherever search lists it. */
export const kindIcon: Record<GalleryKind, { Icon: KindIcon; tone: ItemTone; label: string }> = {
  chat: { Icon: MessagesSquare, tone: itemTones.chat, label: "Chat" },
  image: { Icon: ImageIcon, tone: itemTones.image, label: "Image" },
  file: { Icon: FileText, tone: itemTones.document, label: "File" },
};
