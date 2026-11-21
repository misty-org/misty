import { MessagesSquare } from "lucide-react";
import type { ComponentType } from "react";
import { itemTones, type ItemTone } from "@misty/ui";
import type { GalleryKind } from "./galleryItems";

type KindIcon = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

/** Each kind's glyph, tone and name, wherever search lists it. */
export const kindIcon: Record<GalleryKind, { Icon: KindIcon; tone: ItemTone; label: string }> = {
  chat: { Icon: MessagesSquare, tone: itemTones.chat, label: "Chat" },
};
