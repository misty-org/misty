import { FlaskConical, MessageCircle, type LucideIcon } from "lucide-react";
import type { SpaceSearchHit } from "@/features/spaces";

/** A result's glyph at the size every row uses. */
export const icon = (Icon: LucideIcon) => <Icon aria-hidden />;

export const spaceIcons: Record<SpaceSearchHit["kind"], LucideIcon> = {
  notebook: FlaskConical,
  message: MessageCircle,
};

export const spaceGroups: Record<SpaceSearchHit["kind"], string> = {
  notebook: "Notebooks",
  message: "Messages",
};
