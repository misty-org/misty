export const transferStyles = {
  workspace: "bg-background text-foreground",
  pane: "grid h-full min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_36px] overflow-hidden bg-background",
  panelsScroll: "min-h-0 min-w-0 overflow-hidden",
  threePanel: "grid h-full min-h-0 w-full",
  panel: "min-h-0 min-w-0 overflow-hidden border-r border-border/70 bg-muted/20 last:border-r-0",
  listPanel:
    "grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden border-r border-border/70 bg-background",
  listPanelNoRight: "border-r-0",
  toolbar:
    "flex min-h-11 min-w-0 items-center gap-2 border-b border-border/70 bg-background px-3 py-1.5",
  searchBox:
    "flex h-8 w-[min(360px,38vw)] min-w-48 items-center gap-2 rounded-md border border-input bg-background px-2.5 text-muted-foreground transition-[border-color,box-shadow] focus-within:ring-2 focus-within:ring-ring/50 [&>input]:h-full [&>input]:min-w-0 [&>input]:flex-1 [&>input]:rounded-none [&>input]:border-0 [&>input]:bg-transparent [&>input]:p-0 [&>input]:shadow-none [&>input]:focus-visible:ring-0",
  actionFeedback: "mr-auto min-w-0 truncate rounded-md px-2 py-1 text-xs",
  actionFeedbackBusy: "bg-primary/10 text-primary",
  actionFeedbackSuccess:
    "bg-[color-mix(in_srgb,var(--misty-success)_12%,transparent)] text-[var(--misty-success)]",
  actionFeedbackError: "bg-destructive/10 text-destructive",
  tableWrap:
    "h-full min-h-0 overflow-auto pr-3 [overscroll-behavior:contain] [scrollbar-gutter:stable_both-edges]",
  table: "table-fixed select-none border-collapse",
  tableHeader:
    "sticky top-0 z-[2] select-none border-b border-border/70 bg-background px-2.5 py-2 text-left align-middle text-xs font-medium leading-none text-muted-foreground",
  tableHeaderDragging: "opacity-60",
  tableHeaderControl:
    "inline-block h-auto min-w-0 max-w-full truncate rounded-sm px-0 py-0 align-middle font-[inherit] text-inherit hover:bg-transparent hover:text-foreground",
  tableResizeHandle:
    "absolute right-[-3px] top-0 z-[3] h-full w-[7px] cursor-col-resize hover:bg-primary/30",
  tableRow:
    "group h-[46px] cursor-default select-none outline-none hover:bg-muted/60 focus-visible:bg-accent/60",
  tableRowFocused: "bg-accent/45",
  tableRowSelected: "bg-accent/70",
  tableCell:
    "min-w-0 select-none overflow-hidden text-ellipsis whitespace-nowrap border-b border-border/60 px-2.5 py-1.5 text-left align-middle text-[13px] leading-4 text-foreground",
  nameCellContent: "flex min-w-0 items-center gap-1.5",
  treeToggle:
    "size-8 shrink-0 rounded-md p-0 text-muted-foreground hover:bg-accent hover:text-accent-foreground",
  treeSpacer: "block size-8 shrink-0",
  nameText: "min-w-0 flex-1 overflow-hidden",
  tablePrimary: "block min-w-0 truncate font-medium leading-[17px]",
  tableSecondary: "mt-px block min-w-0 truncate text-xs leading-[15px] text-muted-foreground",
  rowActions:
    "flex h-full items-center justify-end whitespace-nowrap opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100",
  rowActionsVisible: "opacity-100",
  rowActionGroup: "inline-flex h-8 overflow-hidden rounded-md border border-border/70 bg-muted/50",
  rowActionIconButton:
    "h-[30px] w-8 rounded-none border-0 border-r border-border/70 bg-transparent p-0 text-muted-foreground shadow-none last:border-r-0 hover:bg-accent hover:text-accent-foreground",
  pagination:
    "flex min-w-0 items-center justify-between gap-2 border-t border-border/70 px-3 py-1.5 text-xs text-muted-foreground",
  contentScroll: "h-full overflow-auto p-3",
  filterHeading: "mb-3 flex min-h-8 items-center justify-between gap-2",
  filterTitle: "text-sm font-semibold text-foreground",
  filterSection: "grid gap-2 border-t border-border/60 py-3 first:border-t-0 first:pt-0",
  filterSectionTitle:
    "m-0 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground",
  filterOptions: "grid gap-0.5",
  filterOption:
    "grid min-h-8 min-w-0 cursor-default grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-1 text-sm leading-none text-foreground hover:bg-accent/50",
  filterOptionLabel: "min-w-0 truncate leading-5",
  filterOptionCount: "justify-self-end text-xs not-italic tabular-nums text-muted-foreground",
  filterEmpty: "text-sm leading-5 text-muted-foreground",
  sortDirection: "grid grid-cols-2 gap-2",
  detailContent: "grid h-full content-start overflow-auto p-3.5",
  detailEmpty: "flex h-full items-center justify-center p-4",
  detailHeader: "grid gap-2 border-b border-border/70 pb-3",
  detailTitle: "truncate text-base font-semibold text-foreground",
  detailActions: "mt-3 flex flex-wrap gap-2 border-t border-border/70 pt-3",
  detailRow: "grid gap-1 border-b border-border/60 py-2.5 text-xs",
  detailLabel: "text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground",
  detailValue: "min-w-0 font-medium text-foreground [overflow-wrap:anywhere]",
  detailDangerValue: "min-w-0 font-medium text-destructive [overflow-wrap:anywhere]",
  progressMeta: "flex min-w-0 items-center justify-between gap-2 text-xs text-muted-foreground",
  progressMetaStrong: "font-medium text-foreground",
  bottomBar: "flex min-w-0 items-center justify-between border-t border-border/60 bg-muted/20 px-2",
  bottomBarSide: "flex min-w-0 items-center gap-1",
} as const;
