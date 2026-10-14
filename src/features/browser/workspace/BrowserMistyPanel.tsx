import type { ReactNode } from "react";
import { MistyPanelSprite, useMistyPanelStore } from "@/features/agents";
import { dockLeaves, useWorkspaceStore } from "@/features/workspace";
import { IconButton } from "@/shared/ui";

/**
 * Whether the Misty panel is open. The panel is a column of its own beside the workspace's
 * panes, a panel apart from the page like the tab drawer, so every browser tab shares it.
 */
export function useBrowserMistyPanel(tabId: string) {
  const paneId = useWorkspaceStore(
    (state) => dockLeaves(state.layout.root).find((pane) => pane.activeViewId === tabId)?.id,
  );
  const open = useMistyPanelStore((s) => s.open);
  return { paneId, here: open, open };
}

/** The toolbar's Misty button: opens the panel, or closes it. */
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

/** The content row under the toolbar: the page. */
export function BrowserMistyRow({ children }: { tabId: string; children: ReactNode }) {
  return <div className="flex min-h-0 min-w-0">{children}</div>;
}
