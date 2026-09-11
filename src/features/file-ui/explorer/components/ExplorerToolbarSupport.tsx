import { cn } from "@/shared/ui";

export const toolbarStyles = {
  root: cn(
    "min-w-0 overflow-visible bg-charcoal-sidebar text-cream",
    "max-[720px]:overflow-x-auto max-[720px]:overflow-y-hidden",
    "max-[720px]:[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
  ),
  navRow: cn(
    "grid min-h-14 min-w-0 grid-cols-[auto_minmax(240px,1fr)_auto]",
    "items-center gap-2 overflow-visible px-3 py-2",
    "max-[980px]:grid-cols-[auto_minmax(180px,1fr)_auto]",
  ),
  actionRow:
    "grid min-h-11 min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center justify-between gap-2 overflow-hidden border-t border-charcoal-border/60 px-3 py-1.5",
  navButtons: "flex min-w-0 flex-none items-center gap-1",
  actionLeft:
    "flex min-w-0 items-center gap-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
  navigationButton: "size-8 rounded-md text-cream-muted shadow-none",
  pathBar: cn(
    "flex h-9 min-w-0 items-center gap-0.5 overflow-x-auto overflow-y-hidden",
    "rounded-md border border-charcoal-border bg-charcoal-card px-1.5",
    "shadow-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
  ),
  pathBarEditing: "border-charcoal-border",
  pathButton:
    "h-7 min-w-fit flex-none gap-0 rounded-sm px-1.5 text-sm font-normal text-cream shadow-none",
  pathInput: cn(
    "h-full min-w-0 w-full appearance-none rounded-none border-0",
    "bg-transparent p-0 font-[inherit] leading-none text-cream shadow-none",
    "outline-none ring-0 focus-visible:ring-0 placeholder:text-cream-muted",
  ),
  breadcrumbCaret: "mr-1.5 flex-none text-cream-muted/70",
  commandSearch:
    "flex h-9 w-full min-w-0 items-center gap-2 rounded-md border border-charcoal-border " +
    "bg-charcoal-card px-1.5 text-cream-muted shadow-none max-[980px]:w-full max-[720px]:min-w-40",
  searchButton: "size-8 shrink-0 rounded-md text-cream-muted",
  commandInput: cn(
    "h-full min-w-0 flex-1 appearance-none rounded-none border-0",
    "bg-transparent p-0 text-cream shadow-none outline-none ring-0",
    "focus-visible:ring-0 placeholder:text-cream-muted",
  ),
  palette:
    "w-[min(420px,calc(100vw-16px))] overflow-hidden rounded-xl border-charcoal-border bg-charcoal-card p-0 text-cream shadow-xl",
  paletteButton: "min-h-11 items-start gap-2.5 rounded-md px-2.5 py-2",
  paletteResultButton:
    "grid min-h-[68px] grid-cols-[44px_minmax(0,1fr)] items-center gap-3 rounded-md px-2.5 py-2",
  paletteThumbnail:
    "grid size-11 place-items-center overflow-hidden rounded-lg border border-charcoal-border bg-charcoal-card text-cream-muted",
  paletteThumbnailImage: "size-full object-cover",
  paletteText: "grid min-w-0 gap-0.5",
  paletteTitle: "min-w-0 truncate font-medium text-cream",
  paletteSummary: "min-w-0 truncate text-sm text-cream-muted",
  paletteSubtitle: "min-w-0 truncate text-xs text-cream-muted",
  newButton: "h-8 gap-1.5 rounded-md px-2.5 text-cream shadow-none",
} as const;
export function cx(...classes: Array<string | false | null | undefined>): string {
  return cn(classes);
}
