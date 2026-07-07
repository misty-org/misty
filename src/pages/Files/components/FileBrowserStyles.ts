export const fileBrowserStyles = {
  browser:
    "grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_36px] overflow-hidden outline outline-0 outline-offset-[-2px]",
  browserLoading: "bg-[var(--misty-surface)]",
  tableSkeleton:
    "min-h-0 min-w-[720px] overflow-hidden",
  tableSkeletonLine:
    "grid grid-cols-[minmax(240px,1fr)_220px_128px_128px] items-center gap-4 border-b border-[var(--misty-border-soft)] px-3.5",
  tableSkeletonHeader: "h-10 bg-[var(--misty-surface-2)]",
  tableSkeletonRow: "h-9 [[data-compact-mode=true]_&]:h-8",
  skeletonCell:
    "relative overflow-hidden rounded-md bg-[var(--misty-surface-3)] after:absolute after:inset-0 after:-translate-x-full after:animate-[misty-skeleton-sweep_1.15s_ease-in-out_infinite] after:bg-[linear-gradient(90deg,transparent,rgba(241,243,244,0.1),transparent)] after:content-['']",
  tableSkeletonHeaderCell: "h-[13px]",
  tableSkeletonCell: "h-3 first:h-4",
  gridSkeleton:
    "grid min-h-0 min-w-0 content-start justify-center gap-2 overflow-hidden p-3.5 [grid-template-columns:repeat(auto-fill,minmax(100px,100px))] [[data-compact-mode=true]_&]:gap-1.5 [[data-compact-mode=true]_&]:p-2.5 [[data-compact-mode=true]_&]:[grid-template-columns:repeat(auto-fill,minmax(92px,92px))]",
  gridSkeletonCell:
    "h-[104px] border border-[var(--misty-border-soft)] [[data-compact-mode=true]_&]:h-[92px]",
  tableWrap:
    "grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden",
  tableHeaderWrap:
    "min-w-0 overflow-hidden bg-[var(--misty-surface-2)]",
  tableResetButton:
    "absolute right-2 top-1.5 z-[4] inline-grid size-7 place-items-center rounded-md border border-transparent bg-[var(--misty-surface-2)] text-[var(--misty-text-muted)] shadow-[0_0_0_1px_var(--misty-border-soft)] hover:bg-[var(--misty-surface-hover)] hover:text-[var(--misty-text)] max-[720px]:hidden",
  tableScroll:
    "min-h-0 min-w-0 overflow-auto [contain:layout_paint] [overscroll-behavior:contain] [scrollbar-gutter:stable] max-[720px]:[scrollbar-gutter:auto]",
  table:
    "w-full min-w-[720px] table-fixed border-separate border-spacing-0 max-[720px]:min-w-0 max-[720px]:[&_td:first-child]:w-[64%] max-[720px]:[&_td:nth-child(2)]:w-[36%] max-[720px]:[&_td:nth-child(n+3)]:hidden max-[720px]:[&_th:first-child]:w-[64%] max-[720px]:[&_th:nth-child(2)]:w-[36%] max-[720px]:[&_th:nth-child(n+3)]:hidden",
  tableHeadCell:
    "group/header relative overflow-hidden whitespace-nowrap bg-[var(--misty-surface-2)] px-3 py-1 text-left align-middle text-sm font-semibold text-[var(--misty-text-muted)] shadow-[inset_0_-1px_0_var(--misty-border-soft)] max-[720px]:px-2.5 max-[720px]:py-1.5 max-[720px]:text-xs",
  tableHeadFiller:
    "bg-[var(--misty-surface-2)] p-0 shadow-[inset_0_-1px_0_var(--misty-border-soft)] max-[720px]:hidden",
  tableSort:
    "flex min-h-7 w-full min-w-0 items-center gap-1.5 overflow-hidden border-0 bg-transparent p-0 pr-2 text-left font-[inherit] text-inherit",
  tableSortLabel: "min-w-0 overflow-hidden text-ellipsis",
  tableSortActive: "text-[var(--misty-text)]",
  tableSortIndicator:
    "inline-flex size-[13px] flex-none items-center justify-center text-[var(--misty-text-muted)]",
  tableResizeHandle:
    "absolute right-0 top-0 z-[2] h-full w-[8px] translate-x-1/2 cursor-col-resize after:absolute after:bottom-[8px] after:left-1/2 after:top-[8px] after:w-px after:-translate-x-1/2 after:bg-transparent after:content-[''] group-hover/header:after:bg-[var(--misty-border-strong)] max-[720px]:hidden",
  tableRow:
    "h-11 cursor-default select-none outline outline-0 outline-offset-[-2px] hover:bg-[var(--misty-surface-hover)] [[data-compact-mode=true]_&]:h-9",
  tableRowSelected: "bg-[var(--misty-surface-selected)] text-[var(--misty-text)]",
  tableRowDropTarget: "outline outline-2 outline-[var(--misty-border-strong)]",
  tableRowDragging: "opacity-55",
  tableRowDeleted: "text-[var(--misty-text-subtle)]",
  tableRowInlineEditing: "relative z-[3]",
  tableCell:
    "cursor-default select-none overflow-hidden text-ellipsis whitespace-nowrap px-2.5 py-2 text-left text-sm leading-7 [[data-compact-mode=true]_&]:py-1.5 [[data-compact-mode=true]_&]:leading-6 max-[720px]:px-2 max-[720px]:py-1.5 max-[720px]:text-xs",
  directorySizeDots:
    "inline-flex h-7 w-8 items-center gap-1 align-middle [[data-compact-mode=true]_&]:h-6",
  directorySizeDot:
    "size-1.5 rounded-full bg-[var(--misty-text-muted)] opacity-85 motion-safe:animate-bounce",
  tableFillerCell: "p-0 max-[720px]:hidden",
  tableNameCell:
    "flex cursor-default select-none items-center gap-3 overflow-hidden text-ellipsis whitespace-nowrap px-2.5 py-2 text-left text-sm leading-7 [[data-compact-mode=true]_&]:gap-2 [[data-compact-mode=true]_&]:py-1.5 [[data-compact-mode=true]_&]:leading-6 max-[720px]:px-2 max-[720px]:py-1.5 max-[720px]:text-xs",
  tableNameCellEditing: "overflow-visible",
  tableNameText: "min-w-0 cursor-default select-none overflow-hidden text-ellipsis",
  downloadButton:
    "inline-grid size-6 place-items-center rounded-md border border-transparent bg-transparent text-[var(--misty-text-muted)] hover:bg-[var(--misty-surface-hover)] hover:text-[var(--misty-text)]",
  rowDownloadButton: "ml-2 align-middle",
  gridDownloadButton:
    "absolute right-[5px] top-[5px] opacity-100",
  tableIconSlot: "grid h-6 w-6 flex-none place-items-center",
  folderIcon: "fill-[#f5c451] text-[#f2d27a]",
  fileIcon: "text-[var(--misty-text-muted)]",
  iconArchive: "text-[var(--misty-text-muted)]",
  iconAudio: "text-[var(--misty-text-muted)]",
  iconCode: "text-[var(--misty-text-muted)]",
  iconImage: "text-[var(--misty-text-muted)]",
  iconSpreadsheet: "text-[var(--misty-text-muted)]",
  iconText: "text-[var(--misty-text-muted)]",
  iconVideo: "text-[var(--misty-text-muted)]",
  gridScroll:
    "min-h-0 min-w-0 overflow-auto [contain:layout_paint] [overscroll-behavior:contain] [scrollbar-gutter:stable]",
  gridSizer: "relative min-w-0",
  grid:
    "absolute left-3.5 right-3.5 grid content-start justify-center gap-2 [[data-compact-mode=true]_&]:left-2.5 [[data-compact-mode=true]_&]:right-2.5 [[data-compact-mode=true]_&]:gap-1.5",
  gridItem:
    "relative grid min-h-[104px] min-w-0 cursor-default justify-items-center gap-2 rounded-lg border border-transparent bg-transparent px-2 py-3 text-[var(--misty-text-muted)] hover:bg-[var(--misty-surface-hover)] [[data-compact-mode=true]_&]:min-h-[92px] [[data-compact-mode=true]_&]:gap-1.5 [[data-compact-mode=true]_&]:px-[7px] [[data-compact-mode=true]_&]:py-[9px]",
  gridItemSelected: "selected border-[var(--misty-border-strong)] bg-[var(--misty-surface-selected)] text-[var(--misty-text)]",
  gridItemDropTarget: "border-[var(--misty-border-strong)] bg-[var(--misty-surface-selected)] shadow-[0_0_0_1px_var(--misty-border-strong)]",
  gridItemDragging: "opacity-55",
  gridItemDeleted: "deleted text-[var(--misty-text-subtle)] [&>span:not(.inline-name-editor)]:opacity-[0.86]",
  gridItemInlineEdit: "relative z-[2]",
  gridThumb:
    "grid h-12 w-16 place-items-center overflow-hidden rounded-md border border-[var(--misty-border-soft)] bg-[var(--misty-surface)] [[data-compact-mode=true]_&]:h-11 [[data-compact-mode=true]_&]:w-14",
  gridThumbImage: "h-full w-full object-cover",
  gridThumbIcon: "grid h-12 w-16 place-items-center [[data-compact-mode=true]_&]:h-11 [[data-compact-mode=true]_&]:w-14",
  gridNameText: "max-w-full overflow-hidden text-ellipsis whitespace-nowrap",
  inlineEditor: "inline-name-editor relative inline-flex min-w-0 max-w-full items-center",
  inlineEditorGrid: "w-full justify-center",
  inlineEditorInvalid: "gap-[7px]",
  inlineFields:
    "inline-flex min-w-0 max-w-full items-center overflow-hidden rounded-[5px] border border-[var(--misty-border-strong)] bg-[var(--misty-surface)] shadow-[0_0_0_2px_rgba(241,243,244,0.08)]",
  inlineFieldsGrid: "w-full",
  inlineFieldsInvalid:
    "border-[var(--misty-border-strong)] shadow-[0_0_0_2px_rgba(255,255,255,0.07)]",
  inlineFieldsInvalidTable: "max-w-[174px]",
  inlineInput:
    "h-7 w-[min(210px,100%)] min-w-16 border-0 bg-transparent px-[7px] text-[var(--misty-text)] outline-0",
  lockedExtension: "flex-none py-0 pl-0 pr-[7px] text-[var(--misty-text-subtle)]",
  inlineError:
    "absolute left-0 top-[calc(100%+5px)] z-[8] w-max max-w-[260px] whitespace-normal rounded-[5px] border border-[var(--misty-border)] bg-[var(--misty-glass)] px-[7px] py-[5px] text-[11px] leading-[1.3] text-[var(--misty-text-muted)] shadow-[0_8px_20px_var(--misty-shadow)]",
  inlineErrorTable:
    "static min-w-0 flex-auto overflow-hidden text-ellipsis whitespace-nowrap border-0 bg-transparent p-0 text-[var(--misty-text-subtle)] shadow-none",
  passiveDraft:
    "inline-flex min-w-0 max-w-full items-center gap-0 overflow-hidden rounded-[5px] border border-[var(--misty-border)] bg-[var(--misty-surface-2)] px-1.5 py-[3px] text-[var(--misty-text)]",
  passiveDraftInvalid: "border-[var(--misty-border-strong)] text-[var(--misty-text-muted)]",
  passiveDraftText: "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap",
  passiveDraftExtension: "flex-none text-[inherit] text-[var(--misty-text-subtle)]",
  passiveDraftCaret:
    "ml-0.5 h-4 w-px flex-none animate-[passive-rename-caret_1.1s_step-end_infinite] bg-[var(--misty-text-muted)] opacity-75",
  footer:
    "flex min-h-9 min-w-0 items-center justify-between gap-3 overflow-hidden border-t border-[var(--misty-border-soft)] bg-[var(--misty-surface)] px-3 py-1.5 text-xs text-[var(--misty-text-subtle)] max-[720px]:min-h-8 max-[720px]:px-2.5 max-[720px]:py-0 max-[720px]:text-[11px]",
  footerGroup:
    "flex min-w-0 items-center gap-2 overflow-hidden",
  footerRight:
    "flex min-w-0 flex-none items-center justify-end gap-2 overflow-hidden",
  footerItem:
    "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap",
  footerButton:
    "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap border-0 bg-transparent p-0 text-[var(--misty-text-subtle)] hover:text-[var(--misty-text)]",
  footerButtonActive:
    "text-[var(--misty-text-muted)]",
  footerSeparator:
    "h-3 w-px flex-none bg-[var(--misty-border)]",
  empty: "p-6 text-[var(--misty-text-muted)]",
  emptyError: "text-[var(--misty-text-muted)]",
  dropActive: "outline outline-2 outline-offset-[-2px] outline-[var(--misty-border-strong)]",
} as const;
