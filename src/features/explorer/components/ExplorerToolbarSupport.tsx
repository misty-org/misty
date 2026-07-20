import type { SearchResult } from "@/models/interfaces/services/misty-api";
import { cn } from "@/ui";

export const toolbarStyles = {
  root: "min-w-0 overflow-visible bg-[var(--misty-files-panel-bg,var(--background))] text-foreground max-[720px]:overflow-x-auto max-[720px]:overflow-y-hidden max-[720px]:[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
  navRow:
    "grid min-h-14 min-w-0 grid-cols-[auto_minmax(240px,1fr)_auto] items-center gap-2 overflow-visible px-3 py-2 max-[980px]:grid-cols-[auto_minmax(180px,1fr)_auto]",
  actionRow:
    "grid min-h-11 min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center justify-between gap-2 overflow-hidden border-t border-border/60 px-3 py-1.5",
  navButtons: "flex min-w-0 flex-none items-center gap-1",
  actionLeft:
    "flex min-w-0 items-center gap-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
  navigationButton: "size-8 rounded-md text-muted-foreground shadow-none",
  pathBar:
    "flex h-9 min-w-0 items-center gap-0.5 overflow-x-auto overflow-y-hidden rounded-md border border-input bg-muted/30 px-1.5 shadow-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
  pathBarEditing: "border-ring ring-2 ring-ring/20",
  pathButton:
    "h-7 min-w-fit flex-none gap-0 rounded-sm px-1.5 text-sm font-normal text-foreground shadow-none",
  pathInput:
    "h-full min-w-0 w-full appearance-none rounded-none border-0 bg-transparent p-0 font-[inherit] leading-none text-foreground shadow-none outline-none ring-0 focus-visible:ring-0 placeholder:text-muted-foreground",
  breadcrumbCaret: "mr-1.5 flex-none text-muted-foreground/70",
  commandSearch:
    "flex h-9 w-full min-w-0 items-center gap-2 rounded-md border border-input bg-muted/30 px-1.5 text-muted-foreground shadow-none focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20 max-[980px]:w-full max-[720px]:min-w-40",
  searchButton: "size-8 shrink-0 rounded-md text-muted-foreground",
  commandInput:
    "h-full min-w-0 flex-1 appearance-none rounded-none border-0 bg-transparent p-0 text-foreground shadow-none outline-none ring-0 focus-visible:ring-0 placeholder:text-muted-foreground",
  palette:
    "w-[min(420px,calc(100vw-16px))] overflow-hidden rounded-xl border-border bg-popover p-0 text-popover-foreground shadow-xl",
  paletteButton: "min-h-11 items-start gap-2.5 rounded-md px-2.5 py-2",
  paletteResultButton:
    "grid min-h-[68px] grid-cols-[44px_minmax(0,1fr)] items-center gap-3 rounded-md px-2.5 py-2",
  paletteThumbnail:
    "grid size-11 place-items-center overflow-hidden rounded-lg border border-border bg-muted text-muted-foreground",
  paletteThumbnailImage: "size-full object-cover",
  paletteText: "grid min-w-0 gap-0.5",
  paletteTitle: "min-w-0 truncate font-medium text-foreground",
  paletteSummary: "min-w-0 truncate text-sm text-muted-foreground",
  paletteSubtitle: "min-w-0 truncate text-xs text-muted-foreground",
  newButton: "h-8 gap-1.5 rounded-md px-2.5 text-foreground shadow-none",
} as const;

export const paneToolbarActionStyles = {
  section: "flex flex-none items-center gap-1 overflow-visible",
  button:
    "size-7 rounded-md text-muted-foreground shadow-none data-[state=open]:bg-accent data-[state=open]:text-accent-foreground",
  buttonActive: "bg-accent text-accent-foreground",
} as const;

export function cx(...classes: Array<string | false | null | undefined>): string {
  return cn(classes);
}

export function fuzzyIncludes(haystack: string, needle: string): boolean {
  if (haystack.includes(needle)) return true;
  let index = 0;
  for (const char of needle) {
    index = haystack.indexOf(char, index);
    if (index === -1) return false;
    index += 1;
  }
  return true;
}

export function searchResultSubtitle(result: SearchResult): string {
  return [searchResultSummary(result), searchResultContext(result)].filter(Boolean).join(" · ");
}

export function searchResultSummary(result: SearchResult): string {
  const reasons = (result.match?.reasons ?? []).filter(
    (reason) => reason && !["semantic", "metadata", "hybrid"].includes(reason.toLocaleLowerCase()),
  );
  if (reasons.length > 0) return reasons.slice(0, 2).join(" · ");
  if (result.match?.description) return result.match.description;
  if (result.match?.tags?.length) return result.match.tags.slice(0, 3).join(" · ");
  return result.entry.kind === "folder" ? "Folder name match" : "Filename match";
}

export function searchResultContext(result: SearchResult): string {
  const entry = result.entry;
  const source =
    entry.location.kind === "remote" ? (entry.location.remoteName ?? "Remote") : "Local";
  const match =
    result.match?.mediaMatchKind === "spoken"
      ? `${formatSearchTime(result.match.mediaStartMs ?? 0)} · Spoken audio`
      : result.match?.mediaMatchKind === "visual"
        ? `${formatSearchTime(result.match.mediaStartMs ?? 0)} · Visual scene`
        : result.match?.kind === "hybrid"
          ? "Semantic + metadata"
          : result.match?.kind === "semantic"
            ? "Semantic"
            : "Filename";
  const kind =
    result.match?.assetKind ||
    (entry.kind === "folder"
      ? "Folder"
      : entry.extension.replace(/^\./, "").toUpperCase() || "File");
  return [match, source, kind, parentName(entry.path)].filter(Boolean).join(" · ");
}

function formatSearchTime(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function parentName(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.length > 1 ? (parts[parts.length - 2] ?? "") : "";
}
