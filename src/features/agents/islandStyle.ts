import { cn } from "@/shared/ui";

/** The control island's card, shared by Misty's window and an agent's own window. */
export const islandClass = cn(
  "pointer-events-auto fixed inset-x-0 bottom-4 layer-workspace-overlay mx-auto flex flex-col gap-2",
  "w-[min(560px,calc(100dvw-32px))] rounded-2xl border border-charcoal-border bg-charcoal-card",
  "p-2 text-cream shadow-lg",
);
