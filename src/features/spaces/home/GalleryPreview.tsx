import { MessagesSquare } from "lucide-react";
import type { ComponentType } from "react";
import { itemTones, type ItemTone } from "@misty/ui";
import type { GalleryKind } from "./gallery_items";

type KindIcon = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

export const kindIcon: Record<GalleryKind, { Icon: KindIcon; tone: ItemTone; label: string }> = {
  chat: { Icon: MessagesSquare, tone: itemTones.chat, label: "Chat" },
};
