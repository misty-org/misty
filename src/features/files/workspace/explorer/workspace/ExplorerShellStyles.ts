import { cn } from "@/shared/ui";
export const explorerShellStyles = {
  workspaceBase: cn(
    "relative grid h-full min-h-0 overflow-hidden grid-cols-[minmax(0,1fr)]",
    "grid-rows-[minmax(0,1fr)] bg-charcoal-sidebar max-[980px]:grid-cols-1",
    "max-[720px]:h-full",
  ),
  workspaceCollapsed: "sidebar-collapsed grid-cols-[minmax(0,1fr)]",
  main: "col-start-1 col-end-2 row-start-1 min-h-0 min-w-0 overflow-hidden max-[980px]:row-start-1 max-[980px]:min-w-0",
  bottomBar:
    "grid min-h-[28px] min-w-0 grid-cols-[auto_auto] items-center justify-between gap-2 border-t border-charcoal-border/60 bg-charcoal-sidebar px-2",
  bottomBarGroup: "grid grid-flow-col auto-cols-max items-center gap-1",
  paneHeaderActions: "flex h-full flex-none items-center gap-5",
  paneHeaderActionSection: "flex flex-none items-center gap-1 overflow-visible",
} as const;
