export const fileBrowserStyles = {
  browser:
    "grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_36px] overflow-hidden outline outline-0 outline-offset-[-2px]",
  browserLoading: "bg-[#0e0e0e]",
  tableSkeleton:
    "min-h-0 min-w-[720px] overflow-hidden",
  tableSkeletonLine:
    "grid grid-cols-[minmax(240px,1fr)_220px_128px_128px] items-center gap-4 border-b border-[#262626] px-3.5",
  tableSkeletonHeader: "h-10 bg-[#171717]",
  tableSkeletonRow: "h-9 [[data-compact-mode=true]_&]:h-8",
  skeletonCell:
    "relative overflow-hidden rounded-md bg-[#171717] after:absolute after:inset-0 after:-translate-x-full after:animate-[misty-skeleton-sweep_1.15s_ease-in-out_infinite] after:bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.11),transparent)] after:content-['']",
  tableSkeletonHeaderCell: "h-[13px]",
  tableSkeletonCell: "h-3 first:h-4",
  gridSkeleton:
    "grid min-h-0 min-w-0 content-start justify-center gap-2 overflow-hidden p-3.5 [grid-template-columns:repeat(auto-fill,minmax(100px,100px))] [[data-compact-mode=true]_&]:gap-1.5 [[data-compact-mode=true]_&]:p-2.5 [[data-compact-mode=true]_&]:[grid-template-columns:repeat(auto-fill,minmax(92px,92px))]",
  gridSkeletonCell:
    "h-[104px] border border-[#222222] [[data-compact-mode=true]_&]:h-[92px]",
  tableWrap:
    "grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden",
  tableHeaderWrap:
    "min-w-0 overflow-hidden bg-[#111111]",
  tableScroll:
    "min-h-0 min-w-0 overflow-auto [overscroll-behavior:contain] [scrollbar-gutter:stable] max-[720px]:[scrollbar-gutter:auto]",
  table:
    "w-full min-w-[720px] table-fixed border-separate border-spacing-0 max-[720px]:min-w-0 max-[720px]:[&_td:first-child]:w-[64%] max-[720px]:[&_td:nth-child(2)]:w-[36%] max-[720px]:[&_td:nth-child(n+3)]:hidden max-[720px]:[&_th:first-child]:w-[64%] max-[720px]:[&_th:nth-child(2)]:w-[36%] max-[720px]:[&_th:nth-child(n+3)]:hidden",
  tableHeadCell:
    "group/header relative overflow-hidden whitespace-nowrap bg-[#111111] px-3 py-1 text-left align-middle text-sm font-semibold text-[#d5d5d5] shadow-[inset_0_-1px_#202020] max-[720px]:px-2.5 max-[720px]:py-1.5 max-[720px]:text-xs",
  tableHeadFiller:
    "bg-[#111111] p-0 shadow-[inset_0_-1px_#202020] max-[720px]:hidden",
  tableSort:
    "flex min-h-7 w-full min-w-0 items-center gap-1.5 overflow-hidden border-0 bg-transparent p-0 pr-2 text-left font-[inherit] text-inherit",
  tableSortLabel: "min-w-0 overflow-hidden text-ellipsis",
  tableSortActive: "text-[#efefef]",
  tableSortIndicator:
    "inline-flex size-[13px] flex-none items-center justify-center text-[#a5a5a5]",
  tableResizeHandle:
    "absolute right-0 top-0 z-[2] h-full w-[8px] translate-x-1/2 cursor-col-resize after:absolute after:bottom-[8px] after:left-1/2 after:top-[8px] after:w-px after:-translate-x-1/2 after:bg-transparent after:content-[''] group-hover/header:after:bg-[#3a3a3a] max-[720px]:hidden",
  tableRow:
    "h-11 cursor-default select-none outline outline-0 outline-offset-[-2px] transition-[background-color,outline-color] duration-100 hover:bg-[#1e1e1e] [[data-compact-mode=true]_&]:h-9",
  tableRowSelected: "bg-[#1e1e1e]",
  tableRowDropTarget: "outline outline-2 outline-[#6d88ff]",
  tableRowDragging: "opacity-55",
  tableRowDeleted: "text-[#a2a2a2]",
  tableRowInlineEditing: "relative z-[3]",
  tableCell:
    "cursor-default select-none overflow-hidden text-ellipsis whitespace-nowrap px-2.5 py-2 text-left text-sm leading-7 [[data-compact-mode=true]_&]:py-1.5 [[data-compact-mode=true]_&]:leading-6 max-[720px]:px-2 max-[720px]:py-1.5 max-[720px]:text-xs",
  directorySizeDots:
    "inline-flex h-7 w-8 items-center gap-1 align-middle [[data-compact-mode=true]_&]:h-6",
  directorySizeDot:
    "size-1.5 rounded-full bg-[#c7c7c7] opacity-85 motion-safe:animate-bounce",
  tableFillerCell: "p-0 max-[720px]:hidden",
  tableNameCell:
    "flex cursor-default select-none items-center gap-3 overflow-hidden text-ellipsis whitespace-nowrap px-2.5 py-2 text-left text-sm leading-7 [[data-compact-mode=true]_&]:gap-2 [[data-compact-mode=true]_&]:py-1.5 [[data-compact-mode=true]_&]:leading-6 max-[720px]:px-2 max-[720px]:py-1.5 max-[720px]:text-xs",
  tableNameCellEditing: "overflow-visible",
  tableNameText: "min-w-0 cursor-default select-none overflow-hidden text-ellipsis",
  downloadButton:
    "inline-grid size-6 place-items-center rounded-md border border-transparent bg-transparent text-[#a5a5a5] hover:border-[#3e3e3e] hover:bg-[#272727] hover:text-[#efefef]",
  rowDownloadButton: "ml-2 align-middle",
  gridDownloadButton:
    "absolute right-[5px] top-[5px] opacity-0 group-hover/item:opacity-100 focus-visible:opacity-100",
  tableIconSlot: "grid h-6 w-6 flex-none place-items-center",
  folderIcon: "text-[#86b7ff]",
  fileIcon: "text-[#a7c8ff]",
  iconArchive: "text-[#d6a3ff]",
  iconAudio: "text-[#c8a7ff]",
  iconCode: "text-[#7dd3fc]",
  iconImage: "text-[#79d99a]",
  iconSpreadsheet: "text-[#85d98f]",
  iconText: "text-[#d8e6ff]",
  iconVideo: "text-[#f4a6d7]",
  gridScroll:
    "min-h-0 min-w-0 overflow-auto [contain:layout_paint] [overscroll-behavior:contain] [scrollbar-gutter:stable]",
  gridSizer: "relative min-w-0",
  grid:
    "absolute left-3.5 right-3.5 grid content-start justify-center gap-2 [[data-compact-mode=true]_&]:left-2.5 [[data-compact-mode=true]_&]:right-2.5 [[data-compact-mode=true]_&]:gap-1.5",
  gridItem:
    "group/item relative grid min-h-[104px] min-w-0 cursor-default justify-items-center gap-2 rounded-lg border border-transparent bg-transparent px-2 py-3 text-[#d5d5d5] transition-[background-color,border-color,box-shadow] duration-100 hover:border-[#353535] hover:bg-[#1e1e1e] [[data-compact-mode=true]_&]:min-h-[92px] [[data-compact-mode=true]_&]:gap-1.5 [[data-compact-mode=true]_&]:px-[7px] [[data-compact-mode=true]_&]:py-[9px]",
  gridItemSelected: "selected border-[#353535] bg-[#1e1e1e]",
  gridItemDropTarget: "border-[#6d88ff] bg-[#1f2538] shadow-[0_0_0_1px_rgba(109,136,255,0.45)]",
  gridItemDragging: "opacity-55",
  gridItemDeleted: "deleted text-[#a2a2a2] [&>span:not(.inline-name-editor)]:opacity-[0.86]",
  gridItemInlineEdit: "relative z-[2]",
  gridNameText: "max-w-full overflow-hidden text-ellipsis whitespace-nowrap",
  inlineEditor: "inline-name-editor relative inline-flex min-w-0 max-w-full items-center",
  inlineEditorGrid: "w-full justify-center",
  inlineEditorInvalid: "gap-[7px]",
  inlineFields:
    "inline-flex min-w-0 max-w-full items-center overflow-hidden rounded-[5px] border border-[#787878] bg-[#0d0d0d] shadow-[0_0_0_2px_rgba(120,120,120,0.18)]",
  inlineFieldsGrid: "w-full",
  inlineFieldsInvalid:
    "border-[#6e6e6e] shadow-[0_0_0_2px_rgba(109,109,109,0.16)]",
  inlineFieldsInvalidTable: "max-w-[174px]",
  inlineInput:
    "h-7 w-[min(210px,100%)] min-w-16 border-0 bg-transparent px-[7px] text-[#f0f0f0] outline-0",
  lockedExtension: "flex-none py-0 pl-0 pr-[7px] text-[#a2a2a2]",
  inlineError:
    "absolute left-0 top-[calc(100%+5px)] z-[8] w-max max-w-[260px] whitespace-normal rounded-[5px] border border-[#3f3f3f] bg-[#191919] px-[7px] py-[5px] text-[11px] leading-[1.3] text-[#c6c6c6] shadow-[0_8px_20px_rgba(0,0,0,0.38)]",
  inlineErrorTable:
    "static min-w-0 flex-auto overflow-hidden text-ellipsis whitespace-nowrap border-0 bg-transparent p-0 text-[#a2a2a2] shadow-none",
  passiveDraft:
    "inline-flex min-w-0 max-w-full items-center gap-0 overflow-hidden rounded-[5px] border border-[#444444] bg-[#101010] px-1.5 py-[3px] text-[#e5e5e5]",
  passiveDraftInvalid: "border-[#494949] text-[#cdcdcd]",
  passiveDraftText: "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap",
  passiveDraftExtension: "flex-none text-[inherit] text-[#989898]",
  passiveDraftCaret:
    "ml-0.5 h-4 w-px flex-none animate-[passive-rename-caret_1.1s_step-end_infinite] bg-[#b3b3b3] opacity-75",
  footer:
    "flex min-h-9 min-w-0 items-center justify-between gap-3 overflow-hidden border-t border-[#202020] px-3 py-1.5 text-xs text-[#949494] max-[720px]:min-h-8 max-[720px]:px-2.5 max-[720px]:py-0 max-[720px]:text-[11px]",
  footerGroup:
    "flex min-w-0 items-center gap-2 overflow-hidden",
  footerRight:
    "flex min-w-0 flex-none items-center justify-end gap-2 overflow-hidden",
  footerItem:
    "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap",
  footerButton:
    "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap border-0 bg-transparent p-0 text-[#949494] hover:text-[#eeeeee]",
  footerButtonActive:
    "text-[#d0d0d0]",
  footerSeparator:
    "h-3 w-px flex-none bg-[#303030]",
  empty: "p-6 text-[#adadad]",
  emptyError: "text-[#a8a8a8]",
  dropActive: "outline outline-2 outline-offset-[-2px] outline-[#6d88ff]",
} as const;
