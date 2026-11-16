import { cn } from "@/shared/ui";

/** The talk panel's place: docked on the right under the bar; on a narrow window, along the bottom. */
export const talkPanelClass = cn(
  "absolute top-14 right-[calc(0.75rem+var(--window-chrome-right,0px))] z-[var(--stack-overlay)]",
  "flex max-h-[calc(100%-9rem)] w-90 max-w-[calc(100%-1.5rem)] flex-col gap-2.5 p-3",
  "max-[792px]:inset-x-3 max-[792px]:top-auto max-[792px]:bottom-4 max-[792px]:max-h-[60%]",
  "max-[792px]:w-auto max-[792px]:max-w-none",
);

/** A message box's frame inside the talk panel. */
export const talkFieldClass = "flex items-end gap-1.5 py-1.5 pr-1.5 pl-3";
