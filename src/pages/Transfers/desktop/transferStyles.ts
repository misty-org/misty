export const transferStyles = {
  workspace: "bg-charcoal-bg text-cream",
  pane: "grid h-full min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_36px] overflow-hidden bg-charcoal-bg",
  panelsScroll: "min-h-0 min-w-0 overflow-hidden",
  threePanel: "grid h-full min-h-0 w-full",
  panel:
    "min-h-0 min-w-0 overflow-hidden border-r border-charcoal-border/70 bg-charcoal-card last:border-r-0",
  listPanel:
    "grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden border-r border-charcoal-border/70 bg-charcoal-bg",
  listPanelNoRight: "border-r-0",
  toolbar:
    "flex min-h-11 min-w-0 items-center gap-2 border-b border-charcoal-border/70 bg-charcoal-bg px-3 py-1.5",
  searchBox:
    "flex h-8 w-[min(360px,38vw)] min-w-48 items-center gap-2 rounded-md border " +
    "border-charcoal-border bg-charcoal-bg px-2.5 text-cream-muted transition-[border-color,box-shadow] " +
    "[&>input]:h-full [&>input]:min-w-0 [&>input]:flex-1 [&>input]:rounded-none " +
    "[&>input]:border-0 [&>input]:bg-transparent [&>input]:p-0 [&>input]:shadow-none " +
    "[&>input]:focus-visible:ring-0",
  actionFeedback: "mr-auto min-w-0 truncate rounded-md px-2 py-1 text-xs",
  actionFeedbackBusy: "bg-charcoal-active text-cream-bright",
  actionFeedbackSuccess: "bg-charcoal-hover text-sage-fg",
  actionFeedbackError: "bg-charcoal-active text-cream-bright",
  tableWrap:
    "h-full min-h-0 overflow-auto pr-3 [overscroll-behavior:contain] [scrollbar-gutter:stable_both-edges]",
  table: "table-fixed select-none border-collapse",
  tableHeader:
    "sticky top-0 z-[2] select-none border-b border-charcoal-border/70 bg-charcoal-bg px-2.5 py-2 text-left align-middle text-xs font-medium leading-none text-cream-muted",
  tableHeaderDragging: "opacity-60",
  tableHeaderControl:
    "inline-block h-auto min-w-0 max-w-full truncate rounded-sm px-0 py-0 align-middle font-[inherit] text-inherit hover:bg-transparent hover:text-cream",
  tableResizeHandle:
    "absolute right-[-3px] top-0 z-[3] h-full w-[7px] cursor-col-resize hover:bg-charcoal-active",
  tableRow:
    "group h-[46px] cursor-default select-none outline-none hover:bg-charcoal-card focus-visible:bg-charcoal-hover",
  tableRowFocused: "bg-charcoal-hover",
  tableRowSelected: "bg-charcoal-hover",
  tableCell:
    "min-w-0 select-none overflow-hidden text-ellipsis whitespace-nowrap border-b border-charcoal-border/60 px-2.5 py-1.5 text-left align-middle text-[13px] leading-4 text-cream",
  nameCellContent: "flex min-w-0 items-center gap-1.5",
  treeToggle:
    "size-8 shrink-0 rounded-md p-0 text-cream-muted hover:bg-charcoal-hover hover:text-cream",
  treeSpacer: "block size-8 shrink-0",
  nameText: "min-w-0 flex-1 overflow-hidden",
  tablePrimary: "block min-w-0 truncate font-medium leading-[17px]",
  tableSecondary: "mt-px block min-w-0 truncate text-xs leading-[15px] text-cream-muted",
  rowActions:
    "flex h-full items-center justify-end whitespace-nowrap opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100",
  rowActionsVisible: "opacity-100",
  rowActionGroup:
    "inline-flex h-8 overflow-hidden rounded-md border border-charcoal-border/70 bg-charcoal-card",
  rowActionIconButton:
    "h-[30px] w-8 rounded-none border-0 border-r border-charcoal-border/70 bg-transparent p-0 text-cream-muted shadow-none last:border-r-0 hover:bg-charcoal-hover hover:text-cream",
  pagination:
    "flex min-w-0 items-center justify-between gap-2 border-t border-charcoal-border/70 px-3 py-1.5 text-xs text-cream-muted",
  contentScroll: "h-full overflow-auto p-3",
  filterHeading: "mb-3 flex min-h-8 items-center justify-between gap-2",
  filterTitle: "text-sm font-semibold text-cream",
  filterSection: "grid gap-2 border-t border-charcoal-border/60 py-3 first:border-t-0 first:pt-0",
  filterSectionTitle: "m-0 text-[11px] font-semibold uppercase tracking-[0.08em] text-cream-muted",
  filterOptions: "grid gap-0.5",
  filterOption:
    "grid min-h-8 min-w-0 cursor-default grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-1 text-sm leading-none text-cream hover:bg-charcoal-hover",
  filterOptionLabel: "min-w-0 truncate leading-5",
  filterOptionCount: "justify-self-end text-xs not-italic tabular-nums text-cream-muted",
  filterEmpty: "text-sm leading-5 text-cream-muted",
  sortDirection: "grid grid-cols-2 gap-2",
  detailContent: "grid h-full content-start overflow-auto p-3.5",
  detailEmpty: "flex h-full items-center justify-center p-4",
  detailHeader: "grid gap-2 border-b border-charcoal-border/70 pb-3",
  detailTitle: "truncate text-base font-semibold text-cream",
  detailActions: "mt-3 flex flex-wrap gap-2 border-t border-charcoal-border/70 pt-3",
  detailRow: "grid gap-1 border-b border-charcoal-border/60 py-2.5 text-xs",
  detailLabel: "text-[11px] font-medium uppercase tracking-[0.06em] text-cream-muted",
  detailValue: "min-w-0 font-medium text-cream [overflow-wrap:anywhere]",
  detailDangerValue: "min-w-0 font-medium text-cream-bright [overflow-wrap:anywhere]",
  progressMeta: "flex min-w-0 items-center justify-between gap-2 text-xs text-cream-muted",
  progressMetaStrong: "font-medium text-cream",
  bottomBar:
    "flex min-w-0 items-center justify-between border-t border-charcoal-border/60 bg-charcoal-card px-2",
  bottomBarSide: "flex min-w-0 items-center gap-1",
} as const;
