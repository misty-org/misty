export const assistantPanelStyles = {
  mikaResizer:
    "absolute bottom-[22px] right-[var(--mika-panel-width,380px)] top-[46px] z-[21] w-[5px] cursor-col-resize bg-transparent after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent after:content-[''] hover:after:bg-border max-[720px]:hidden",
  mikaPanel:
    "absolute bottom-[22px] right-0 top-[46px] z-20 grid min-h-0 min-w-0 w-[min(var(--mika-panel-width,380px),calc(100%_-_48px))] grid-rows-[54px_minmax(0,1fr)] overflow-hidden border-l border-t border-border bg-background text-foreground shadow-lg max-[720px]:top-[38px]",
  mikaBotPanel:
    "fixed bottom-5 right-5 top-[calc(var(--misty-window-titlebar-inset)+20px)] z-[var(--misty-layer-panel)] grid min-h-0 min-w-0 w-[min(440px,calc(100vw_-_112px))] grid-rows-[54px_minmax(0,1fr)] overflow-hidden rounded-xl bg-card text-card-foreground shadow-lg ring-1 ring-foreground/10 max-[720px]:bottom-3 max-[720px]:right-3 max-[720px]:top-[calc(var(--misty-window-titlebar-inset)+12px)] max-[720px]:w-[calc(100vw_-_88px)]",
  mikaBotWindowPanel:
    "pointer-events-auto absolute bottom-[142px] left-2 right-2 top-2 z-20 grid min-h-0 min-w-0 grid-rows-[54px_minmax(0,1fr)] overflow-hidden rounded-xl bg-card text-card-foreground shadow-md ring-1 ring-foreground/10",
  mikaChatWindowPanel:
    "pointer-events-auto absolute inset-0 z-20 grid min-h-0 min-w-0 grid-rows-[54px_minmax(0,1fr)] overflow-hidden rounded-xl bg-card text-card-foreground ring-1 ring-foreground/10",
  chatOverlay:
    "absolute bottom-[76px] right-[18px] z-[19] grid max-h-[min(620px,calc(100vh_-_120px))] w-[min(420px,calc(100vw_-_180px))] grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-xl bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10",
  header: "flex h-[42px] min-w-0 items-center justify-between gap-2.5 border-b border-border px-3",
  mikaHeader: "h-[54px] px-4",
  headerTitle:
    "inline-flex min-w-0 items-center gap-2 overflow-hidden text-ellipsis whitespace-nowrap text-sm font-semibold",
  mikaHeaderTitle: "gap-3 text-base font-semibold",
  headerActions: "flex flex-none items-center gap-1.5",
  runningBadge: "text-[11px] font-medium text-muted-foreground",
  headerButton: "size-8 shrink-0",
  chatBody: "grid min-h-0 grid-rows-[auto_minmax(90px,1fr)_auto] gap-2.5 overflow-hidden p-3",
  mikaBody:
    "relative grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto_auto] gap-3 overflow-hidden bg-background p-4",
  status: "grid border-b border-border",
  chatStatus: "gap-2 pb-2.5",
  mikaStatus: "gap-2 pb-3",
  chatDetails: "m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-xs",
  detailLabel: "text-muted-foreground",
  chatDetailValue: "m-0 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-foreground",
  errorText: "m-0 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive",
  log: "grid min-h-0 content-start overflow-auto pr-0.5",
  chatLog: "gap-2",
  mikaLog: "row-start-2 min-w-0 gap-2.5",
  emptyLog: "m-4 text-sm text-muted-foreground",
  message: "grid min-w-0 gap-1.5 rounded-lg bg-muted/40 p-2.5 text-sm",
  userMessage: "bg-accent text-accent-foreground",
  toolMessage: "bg-muted/60",
  errorMessage: "bg-destructive/10 text-destructive",
  messageTitle: "text-xs font-medium text-foreground",
  messageText:
    "m-0 whitespace-pre-wrap break-words font-[inherit] leading-relaxed text-foreground/90",
  planDetails: "grid min-w-0 gap-2",
  planActions: "flex flex-wrap items-center gap-2",
  composer: "grid border-t border-border",
  chatComposer: "gap-2 pt-2.5",
  mikaComposer: "row-start-3 gap-2.5 pt-3",
  textarea: "min-w-0 resize-y bg-muted/30 text-sm shadow-none",
  composerActions: "flex flex-wrap items-center justify-end gap-2",
  mikaComposerActions: "pt-0.5",
  mikaFooter:
    "row-start-4 flex min-h-9 items-center justify-center gap-2 border-t border-border pt-3 text-xs text-muted-foreground",
  mikaEmpty: "grid min-h-0 place-items-center px-3 py-8 text-center",
  mikaEmptyInner: "grid max-w-[260px] justify-items-center gap-3",
  mikaEmptyIcon:
    "relative grid size-16 place-items-center rounded-xl bg-muted text-muted-foreground",
  mikaEmptySpark: "absolute -right-1 top-0 text-primary",
  mikaEmptyTitle: "m-0 text-xl font-semibold text-foreground",
  mikaEmptyText: "m-0 text-sm leading-relaxed text-muted-foreground",
} as const;
