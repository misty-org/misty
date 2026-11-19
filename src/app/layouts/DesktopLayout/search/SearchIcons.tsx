import { CalendarClock, MessageCircle, SquareCheck, type LucideIcon } from "lucide-react";
import type { SpaceSearchHit } from "@/features/spaces";
import { spaceMadeKind } from "@/shared/ui";

/** A result's glyph at the size every row uses. */
export const icon = (Icon: LucideIcon) => <Icon aria-hidden />;

export const spaceIcons: Record<SpaceSearchHit["kind"], LucideIcon> = {
  note: spaceMadeKind("note").icon,
  deck: spaceMadeKind("deck").icon,
  workbook: spaceMadeKind("workbook").icon,
  drawing: spaceMadeKind("drawing").icon,
  message: MessageCircle,
  task: SquareCheck,
  event: CalendarClock,
};

export const spaceGroups: Record<SpaceSearchHit["kind"], string> = {
  note: spaceMadeKind("note").page,
  deck: spaceMadeKind("deck").page,
  workbook: spaceMadeKind("workbook").page,
  drawing: spaceMadeKind("drawing").page,
  message: "Messages",
  task: "Tasks",
  event: "Events",
};
