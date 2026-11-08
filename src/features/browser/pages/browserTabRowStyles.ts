import { cn } from "@/shared/ui";

/** A tab's row in a side tab list: the window's tab sidebar and the agent browser's. */
export const browserTabRowStyles = {
  row: (active: boolean) =>
    cn(
      "misty-workspace-tab group/tab flex items-center rounded-md border text-xs transition-colors",
      "duration-150 select-none focus-within:ring-1",
      "focus-within:ring-cream-muted/50",
      active
        ? "border-charcoal-border/70 bg-charcoal-card text-cream-bright shadow-sm"
        : "border-transparent text-cream-muted hover:bg-charcoal-card/40 hover:text-cream",
    ),
  button: "flex h-full min-w-0 flex-1 items-center justify-start gap-1.5 overflow-hidden pl-2 pr-2",
  title: "misty-workspace-tab-title min-w-0 flex-1 overflow-hidden whitespace-nowrap",
};
