import {
  CalendarClock,
  MessageCircle,
  NotebookPen,
  SquareCheck,
  type LucideIcon,
} from "lucide-react";
import type { SpaceSearchHit } from "@/features/spaces";

/** A result's glyph at the size every row uses. */
export const icon = (Icon: LucideIcon) => <Icon aria-hidden />;

export const spaceIcons: Record<SpaceSearchHit["kind"], LucideIcon> = {
  note: NotebookPen,
  message: MessageCircle,
  task: SquareCheck,
  event: CalendarClock,
};

export const spaceGroups: Record<SpaceSearchHit["kind"], string> = {
  note: "Docs",
  message: "Messages",
  task: "Tasks",
  event: "Events",
};
