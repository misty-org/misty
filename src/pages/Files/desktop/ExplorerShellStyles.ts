export const explorerShellStyles = {
  workspaceBase:
    "relative grid h-full min-h-0 overflow-hidden grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] max-[980px]:grid-cols-1 max-[720px]:h-full max-[720px]:bg-[#070707]",
  workspaceMikaOpen:
    "grid-cols-[minmax(0,1fr)_5px_var(--mika-panel-width,380px)] max-[980px]:grid-cols-1",
  workspaceCollapsed: "sidebar-collapsed grid-cols-[minmax(0,1fr)]",
  workspaceCollapsedMikaOpen:
    "sidebar-collapsed grid-cols-[minmax(0,1fr)_5px_var(--mika-panel-width,380px)] max-[980px]:grid-cols-1",
  main:
    "col-start-1 col-end-2 row-start-1 min-h-0 min-w-0 overflow-hidden max-[980px]:row-start-1 max-[980px]:min-w-0",
  bottomBar:
    "grid min-h-[22px] min-w-0 grid-cols-[auto_auto] items-center justify-between gap-2 border-t border-[#292929] bg-[#080808] px-2 max-[720px]:hidden",
  bottomBarGroup:
    "grid grid-flow-col auto-cols-max items-center gap-1",
  bottomButton:
    "grid h-5 w-[22px] place-items-center rounded border-0 bg-transparent p-0 text-[#868686] hover:bg-[#171717] hover:text-[#dddddd]",
  bottomButtonSelected: "bg-[#171717] text-[#dddddd]",
  paneActionButton:
    "grid h-[22px] w-7 place-items-center rounded-md border-0 bg-transparent p-0 text-[#a7a7a7] hover:bg-[#252525] hover:text-[#eeeeee] disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[#a7a7a7]",
  paneHeaderActions:
    "flex h-full flex-none items-center gap-2.5",
  paneHeaderActionSection:
    "flex h-7 flex-none items-center gap-px overflow-hidden rounded-lg border border-[#242424] bg-[#171717] p-0.5",
} as const;
