export const fileBrowserStyles = {
  browser: [
    "grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_36px] overflow-hidden",
    "bg-[var(--misty-files-content-bg,var(--background))] outline outline-0 outline-offset-[-2px]",
  ].join(" "),
  browserLoading: "bg-[var(--misty-files-content-bg,var(--background))]",
  tableSkeleton: "min-h-0 min-w-[720px] overflow-hidden",
  tableSkeletonLine:
    "grid grid-cols-[minmax(240px,1fr)_220px_128px_128px] items-center gap-4 px-3.5",
  tableSkeletonHeader: "h-10 bg-muted/50",
  tableSkeletonRow: "h-12 [[data-compact-mode=true]_&]:h-10",
  skeletonCell: "relative animate-pulse overflow-hidden rounded-md bg-muted",
  tableSkeletonHeaderCell: "h-[13px]",
  tableSkeletonCell: "h-3 first:h-4",
  gridSkeleton:
    "grid min-h-0 min-w-0 content-start gap-[18px] overflow-hidden p-1 [grid-template-columns:repeat(auto-fill,minmax(144px,1fr))] [[data-compact-mode=true]_&]:gap-2.5 [[data-compact-mode=true]_&]:p-0.5 [[data-compact-mode=true]_&]:[grid-template-columns:repeat(auto-fill,minmax(124px,1fr))]",
  gridSkeletonCell: "h-[156px] [[data-compact-mode=true]_&]:h-[132px]",
  tableWrap:
    "grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-[var(--misty-files-content-bg,var(--background))]",
  tableHeaderWrap: "min-w-0 overflow-hidden",
  tableResetButton:
    "absolute right-2 top-1.5 z-[4] inline-grid size-7 place-items-center rounded-md border border-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:border-ring max-[720px]:hidden",
  tableScroll:
    "misty-transient-scrollbar misty-file-browser-scrollbar min-h-0 min-w-0 overflow-auto [contain:layout_paint] [overscroll-behavior:contain]",
  table:
    "w-full min-w-[720px] table-fixed border-collapse max-[720px]:min-w-0 max-[720px]:[&_td:first-child]:w-[64%] max-[720px]:[&_td:nth-child(2)]:w-[36%] max-[720px]:[&_td:nth-child(n+3)]:hidden max-[720px]:[&_th:first-child]:w-[64%] max-[720px]:[&_th:nth-child(2)]:w-[36%] max-[720px]:[&_th:nth-child(n+3)]:hidden",
  tableHeadCell: "group/header relative overflow-hidden whitespace-nowrap",
  tableHeadFiller: "bg-transparent p-0 shadow-none max-[720px]:hidden",
  tableSort:
    "-mx-2 flex h-10 w-[calc(100%+1rem)] min-w-0 justify-start gap-1.5 overflow-hidden rounded-none border-0 bg-transparent px-2 py-0 text-left font-medium text-muted-foreground shadow-none hover:bg-transparent hover:text-foreground",
  tableSortLabel: "min-w-0 overflow-hidden text-ellipsis",
  tableSortActive: "text-foreground",
  tableSortIndicator:
    "inline-flex size-[13px] flex-none items-center justify-center text-muted-foreground",
  tableResizeHandle:
    "absolute right-0 top-0 z-[2] h-full w-[8px] translate-x-1/2 cursor-col-resize after:absolute after:bottom-[8px] after:left-1/2 after:top-[8px] after:w-px after:-translate-x-1/2 after:bg-transparent after:content-[''] group-hover/header:after:bg-border max-[720px]:hidden",
  tableResizeHandleActive: "after:!bg-ring",
  tableRow:
    "group/file-row cursor-default select-none border-b-0 outline-none hover:bg-muted/50 data-[state=selected]:bg-accent data-[state=selected]:text-accent-foreground focus-visible:relative focus-visible:z-[2] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50",
  tableRowDragging: "opacity-50",
  tableRowCut: "opacity-55",
  tableRowDeleted: "text-muted-foreground opacity-55",
  tableRowInlineEditing: "relative z-[3]",
  tableCell:
    "cursor-default select-none overflow-hidden text-ellipsis whitespace-nowrap text-muted-foreground",
  tableDateCell: "tabular-nums",
  tableNumericCell: "text-left tabular-nums",
  tableNumericHeader: "[&_button]:justify-start",
  directorySizeDots: "inline-flex h-5 w-8 items-center gap-1 align-middle",
  directorySizeDot:
    "size-1.5 rounded-full bg-muted-foreground opacity-85 motion-safe:animate-bounce",
  tableFillerCell: "p-0 max-[720px]:hidden",
  tableNameCell: "cursor-default select-none overflow-hidden",
  tableNameCellEditing: "overflow-visible",
  tableNameText:
    "min-w-0 cursor-default select-none overflow-hidden text-ellipsis whitespace-nowrap",
  tableIconSlot: "grid size-[22px] flex-none place-items-center",
  materialIcon: "block shrink-0 object-contain",
  folderIcon: "text-muted-foreground",
  fileIcon: "text-muted-foreground",
  iconArchive: "text-muted-foreground",
  iconAudio: "text-muted-foreground",
  iconCode: "text-muted-foreground",
  iconImage: "text-muted-foreground",
  iconSpreadsheet: "text-muted-foreground",
  iconText: "text-muted-foreground",
  iconVideo: "text-muted-foreground",
  gridScroll:
    "misty-transient-scrollbar misty-file-browser-scrollbar min-h-0 min-w-0 overflow-auto [contain:layout_paint] [overscroll-behavior:contain]",
  gridSizer: "relative min-w-0",
  grid: "absolute left-[3px] right-[3px] grid content-start gap-[18px] [[data-compact-mode=true]_&]:left-0.5 [[data-compact-mode=true]_&]:right-0.5 [[data-compact-mode=true]_&]:gap-2.5",
  gridItem:
    "relative grid min-h-[156px] min-w-0 content-start cursor-default justify-items-center gap-3 rounded-md border border-transparent bg-transparent px-1.5 py-4 text-muted-foreground outline-none hover:bg-muted/60 hover:text-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring [[data-compact-mode=true]_&]:min-h-[132px] [[data-compact-mode=true]_&]:gap-2.5 [[data-compact-mode=true]_&]:px-1 [[data-compact-mode=true]_&]:py-3",
  gridItemSelected:
    "selected bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground",
  gridItemDragging: "opacity-50",
  gridItemCut: "opacity-55",
  gridItemDeleted: "deleted text-muted-foreground [&>span:not(.inline-name-editor)]:opacity-[0.86]",
  gridItemInlineEdit: "relative z-[2]",
  gridThumb:
    "grid h-[var(--file-grid-thumb-height,82px)] w-[var(--file-grid-thumb-width,116px)] place-items-center overflow-hidden rounded-md border border-border/60 bg-muted/30",
  gridThumbImage: "h-full w-full object-cover",
  gridThumbIcon:
    "grid h-[var(--file-grid-thumb-height,82px)] w-[var(--file-grid-thumb-width,116px)] place-items-center",
  gridNameText:
    "line-clamp-2 min-h-[2.5rem] max-w-full overflow-hidden break-words text-center text-sm font-medium leading-snug text-foreground/90",
  inlineEditor: "inline-name-editor relative inline-flex min-w-0 max-w-full items-center",
  inlineEditorGrid: "w-full justify-center",
  inlineEditorInvalid: "gap-[7px]",
  inlineFields:
    "inline-flex min-w-0 max-w-full items-center overflow-hidden rounded-[5px] border border-ring bg-background shadow-[0_0_0_2px_color-mix(in_srgb,var(--ring)_20%,transparent)]",
  inlineFieldsGrid: "w-full",
  inlineFieldsInvalid:
    "border-destructive shadow-[0_0_0_2px_color-mix(in_srgb,var(--destructive)_18%,transparent)]",
  inlineFieldsInvalidTable: "max-w-[174px]",
  inlineInput:
    "h-7 w-[min(210px,100%)] min-w-16 border-0 bg-transparent px-[7px] text-foreground outline-0",
  lockedExtension: "flex-none py-0 pl-0 pr-[7px] text-muted-foreground",
  passiveDraft:
    "inline-flex min-w-0 max-w-full items-center gap-0 overflow-hidden rounded-[5px] border border-border bg-muted px-1.5 py-[3px] text-foreground",
  passiveDraftInvalid: "border-destructive text-muted-foreground",
  passiveDraftText: "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap",
  passiveDraftExtension: "flex-none text-[inherit] text-muted-foreground",
  passiveDraftCaret:
    "ml-0.5 h-4 w-px flex-none animate-[passive-rename-caret_1.1s_step-end_infinite] bg-muted-foreground opacity-75",
  footer:
    "flex min-h-9 min-w-0 items-center justify-between gap-3 overflow-hidden border-t border-transparent bg-transparent px-3 py-1.5 text-xs text-muted-foreground max-[720px]:min-h-8 max-[720px]:px-2.5 max-[720px]:py-0 max-[720px]:text-[11px]",
  footerGroup: "flex min-w-0 items-center gap-2 overflow-hidden",
  footerItem: "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap",
  empty: "p-6 text-muted-foreground",
  emptyError: "text-muted-foreground",
} as const;
