import { cn } from "@/shared/ui";
export const fileListStyles = {
  browser: [
    "grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_36px] overflow-hidden",
    "bg-charcoal-sidebar outline outline-0 outline-offset-[-2px]",
  ].join(" "),
  browserLoading: "bg-charcoal-sidebar",
  tableSkeleton: "min-h-0 min-w-[720px] overflow-hidden",
  tableSkeletonLine:
    "grid grid-cols-[minmax(240px,1fr)_220px_128px_128px] items-center gap-4 px-3.5",
  tableSkeletonHeader: "h-10 bg-charcoal-card",
  tableSkeletonRow: "h-12 [[data-compact-mode=true]_&]:h-10",
  skeletonCell: "misty-skeleton rounded-md bg-charcoal-card",
  tableSkeletonHeaderCell: "h-[13px]",
  tableSkeletonCell: "h-3 first:h-4",
  tableWrap:
    "grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-charcoal-sidebar",
  tableHeaderWrap: "min-w-0 overflow-hidden",
  tableResetButton: "absolute right-2 top-1.5 z-[4] max-[720px]:hidden",
  tableScroll:
    "misty-transient-scrollbar misty-file-browser-scrollbar min-h-0 min-w-0 overflow-auto [contain:layout_paint] [overscroll-behavior:contain]",
  table: cn(
    "w-full min-w-[720px] table-fixed border-collapse max-[720px]:min-w-0",
    "max-[720px]:[&_td:first-child]:w-[64%]",
    "max-[720px]:[&_td:nth-child(2)]:w-[36%]",
    "max-[720px]:[&_td:nth-child(n+3)]:hidden",
    "max-[720px]:[&_th:first-child]:w-[64%]",
    "max-[720px]:[&_th:nth-child(2)]:w-[36%]",
    "max-[720px]:[&_th:nth-child(n+3)]:hidden",
  ),
  tableHeadCell: "group/header relative overflow-hidden whitespace-nowrap",
  tableHeadFiller: "bg-transparent p-0 shadow-none max-[720px]:hidden",
  tableSort: cn(
    "-mx-2 flex h-10 w-[calc(100%+1rem)] min-w-0 justify-start gap-1.5",
    "overflow-hidden rounded-none border-0 bg-transparent px-2 py-0 text-left",
    "font-medium text-cream-muted shadow-none hover:bg-transparent",
    "hover:text-cream",
  ),
  tableSortLabel: "min-w-0 overflow-hidden text-ellipsis",
  tableSortActive: "text-cream",
  tableSortIndicator:
    "inline-flex size-[13px] flex-none items-center justify-center text-cream-muted",
  tableResizeHandle: cn(
    "absolute -right-1 top-0 z-[2] h-full w-[8px]",
    "cursor-col-resize after:absolute after:inset-x-0 after:bottom-[8px] after:mx-auto",
    "after:top-[8px] after:w-px after:bg-transparent",
    "after:content-[''] group-hover/header:after:bg-charcoal-border",
    "max-[720px]:hidden",
  ),
  tableResizeHandleActive: "after:!bg-charcoal-active",
  tableRow: cn(
    "group/file-row cursor-default select-none border-b-0 outline-none",
    "hover:bg-charcoal-card data-[state=selected]:bg-charcoal-hover",
    "data-[state=selected]:text-cream focus-visible:relative",
    "focus-visible:z-[2] focus-visible:ring-2 focus-visible:ring-inset",
    "focus-visible:ring-charcoal-active/50",
  ),
  tableRowDeleted: "text-cream-muted opacity-55",
  tableCell:
    "cursor-default select-none overflow-hidden text-ellipsis whitespace-nowrap text-cream-muted",
  tableDateCell: "tabular-nums",
  tableNumericCell: "text-left tabular-nums",
  tableNumericHeader: "[&_button]:justify-start",
  tableFillerCell: "p-0 max-[720px]:hidden",
  tableNameCell: "cursor-default select-none overflow-hidden",
  tableNameText:
    "min-w-0 cursor-default select-none overflow-hidden text-ellipsis whitespace-nowrap",
  tableIconSlot: "grid size-5 flex-none place-items-center",
  entryIcon: "block shrink-0",
  // Untoned icons brighten with their row; toned icons keep their color.
  entryIconMuted:
    "text-cream-muted group-data-[state=selected]/file-row:text-cream group-aria-pressed/file-row:text-cream group-hover/file-row:text-cream",
  footer: cn(
    "flex min-h-9 min-w-0 items-center justify-between gap-3 overflow-hidden",
    "border-t border-transparent bg-transparent px-3 py-1.5 text-xs",
    "text-cream-muted max-[720px]:min-h-8 max-[720px]:px-2.5 max-[720px]:py-0",
    "max-[720px]:text-[11px]",
  ),
  footerGroup: "flex min-w-0 items-center gap-2 overflow-hidden",
  footerItem: "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap",
  empty: "p-6 text-cream-muted",
} as const;
