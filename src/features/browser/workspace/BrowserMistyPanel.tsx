import { useEffect, type ReactNode } from "react";
import {
  MistyPanelDock,
  MistyPanelSprite,
  useMistyPanelHost,
  useMistyPanelSide,
  useMistyPanelStore,
} from "@/features/agents";
import { dockLeaves, useWorkspaceStore } from "@/features/workspace";
import { cn, IconButton } from "@/shared/ui";

/**
 * Whether this browser tab's pane holds the Misty panel. The panel sits in one browser
 * pane's content area, under its toolbar; opened by shortcut it lands in the focused
 * browser pane and stays there while focus moves between panes.
 */
function useBrowserMistyPanel(tabId: string) {
  const paneId = useWorkspaceStore(
    (state) => dockLeaves(state.layout.root).find((pane) => pane.activeViewId === tabId)?.id,
  );
  const host = useMistyPanelHost();
  const here = Boolean(paneId) && host === paneId;
  const open = useMistyPanelStore((s) => s.open) && here;
  useEffect(() => {
    if (open && paneId && useMistyPanelStore.getState().paneId !== paneId)
      useMistyPanelStore.getState().setOpen(true, paneId);
  }, [open, paneId]);
  return { paneId, here, open };
}

/** The toolbar's Misty button: opens the panel in this pane, or closes it here. */
export function BrowserMistyButton({ tabId }: { tabId: string }) {
  const { paneId, open } = useBrowserMistyPanel(tabId);
  return (
    <IconButton
      label="Misty"
      tooltip={false}
      aria-pressed={open}
      onClick={() => useMistyPanelStore.getState().setOpen(!open, paneId ?? null)}
    >
      <MistyPanelSprite size={24} />
    </IconButton>
  );
}

/** The content row under the toolbar: the page, with the Misty panel beside it. */
export function BrowserMistyRow({ tabId, children }: { tabId: string; children: ReactNode }) {
  const { here, open } = useBrowserMistyPanel(tabId);
  const side = useMistyPanelSide();
  return (
    <div className={cn("flex min-h-0 min-w-0", side === "left" && "flex-row-reverse")}>
      {children}
      {here ? <MistyPanelDock open={open} side={side} /> : null}
    </div>
  );
}
