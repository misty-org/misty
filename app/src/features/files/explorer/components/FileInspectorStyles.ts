export const inspectorStyles = {
  root: "misty-transient-scrollbar h-full min-w-0 overflow-auto bg-charcoal-sidebar px-3 py-3 text-cream-muted",
  emptyState:
    "grid h-full min-h-0 content-center justify-items-center gap-3 px-6 text-center text-cream-muted",
  emptyStateIcon: "grid size-11 place-items-center rounded-full bg-charcoal-card text-cream-muted",
  emptyStateText: "m-0 max-w-52 text-sm leading-relaxed",
  previewCard:
    "relative isolate grid h-[238px] place-items-center overflow-hidden rounded-lg bg-charcoal-card text-cream-muted",
  previewMedia: "h-full w-full border-0 object-contain",
  audioPreview:
    "grid h-full w-full content-center justify-items-center gap-3 px-4 text-cream-muted",
  audioIcon: "grid size-12 place-items-center rounded-full bg-charcoal-card text-cream",
  audioControl: "w-full max-w-[260px]",
  previewOpenButton:
    "absolute right-2 top-2 z-[3] size-8 opacity-0 shadow-sm transition-opacity focus-visible:opacity-100 group-hover:opacity-100",
  previewLoadingOverlay:
    "pointer-events-none absolute inset-0 z-[2] bg-charcoal-card motion-safe:animate-pulse",
  previewText:
    "m-0 h-full w-full overflow-auto whitespace-pre-wrap break-words p-3 text-left font-mono text-[11px] leading-[1.45] text-cream-muted",
  previewStatus: "px-4 text-center text-sm text-cream-muted",
  folderPreview: "misty-transient-scrollbar h-full w-full overflow-y-auto overflow-x-hidden p-2",
  folderPreviewList: "grid min-w-0 content-start",
  folderPreviewItem:
    "grid h-auto min-h-9 min-w-0 grid-cols-[28px_minmax(0,1fr)_auto] justify-start gap-2 rounded-md px-2 py-1.5 text-left text-cream-muted shadow-none",
  folderPreviewThumb: "grid size-7 place-items-center overflow-hidden",
  folderPreviewName:
    "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-sm font-medium leading-tight",
  folderPreviewSize: "pl-2 text-right text-xs text-cream-muted",
  archivePreviewSummary:
    "mb-1.5 flex min-w-0 items-center justify-between gap-2 px-2 text-xs font-medium capitalize text-cream-muted",
  detailsCard: "mt-3 divide-y divide-charcoal-border border-t border-charcoal-border",
  detailRow: "grid gap-1.5 px-3 py-2.5",
  detailLabel: "text-[11px] font-medium capitalize leading-none text-cream-muted",
  detailValue: "min-w-0 text-sm font-medium leading-snug text-cream [overflow-wrap:anywhere]",
  dots: "inline-flex h-5 items-center gap-1",
  dot: "size-1.5 rounded-full bg-cream-muted motion-safe:animate-bounce",
} as const;
