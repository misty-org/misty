export const explorerShellStyles = {
  workspaceBase:
    "relative grid h-full min-h-0 overflow-hidden grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] bg-[var(--misty-app-page-bg,var(--misty-bg))] max-[980px]:grid-cols-1 max-[720px]:h-full",
  workspaceMikaOpen:
    "grid-cols-[minmax(0,1fr)_5px_var(--mika-panel-width,380px)] max-[980px]:grid-cols-1",
  workspaceCollapsed: "sidebar-collapsed grid-cols-[minmax(0,1fr)]",
  workspaceCollapsedMikaOpen:
    "sidebar-collapsed grid-cols-[minmax(0,1fr)_5px_var(--mika-panel-width,380px)] max-[980px]:grid-cols-1",
  main:
    "col-start-1 col-end-2 row-start-1 min-h-0 min-w-0 overflow-hidden max-[980px]:row-start-1 max-[980px]:min-w-0",
  bottomBar:
    "grid min-h-[22px] min-w-0 grid-cols-[auto_auto] items-center justify-between gap-2 border-t border-transparent bg-transparent px-2 max-[720px]:hidden",
  bottomBarGroup:
    "grid grid-flow-col auto-cols-max items-center gap-1",
  bottomButton:
    "grid h-5 w-[22px] place-items-center rounded border-0 bg-transparent p-0 text-[var(--misty-text-subtle)] hover:bg-[var(--misty-neutral-hover-bg,var(--misty-surface-hover))] hover:text-[var(--misty-text)]",
  bottomButtonSelected: "bg-[var(--misty-neutral-selected-bg,var(--misty-surface-selected))] text-[var(--misty-text)]",
  paneActionButton:
    "grid h-[22px] w-7 place-items-center rounded-md border-0 bg-transparent p-0 text-[var(--misty-text-muted)] hover:bg-[var(--misty-neutral-hover-bg,var(--misty-surface-hover))] hover:text-[var(--misty-text)] disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[var(--misty-text-muted)]",
  paneHeaderActions:
    "flex h-full flex-none items-center gap-2.5",
  paneHeaderActionSection:
    "flex h-7 flex-none items-center gap-px overflow-hidden rounded-lg border border-transparent bg-transparent p-0.5",
} as const;
