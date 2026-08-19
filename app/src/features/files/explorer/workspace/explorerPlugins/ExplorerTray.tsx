import { unreadActivityCountForTool, useActivityStore } from "@/features/activity";
import { useTransfersStore } from "@/features/transfers";
import { openTerminalAtPath } from "@/features/files/native";
import type { PluginCommandEntry, PluginPanelEntry, TransferRecord } from "@/native/contracts";
import { errorText } from "@/shared/lib/format";
import { Button } from "@/shared/ui";
import { ArrowRightLeft, PanelsTopLeft, Terminal } from "lucide-react";
import { useCallback } from "react";
import { useExplorerStore } from "../../store";
import { explorerTrayStyles } from "../ExplorerDesktopPluginStyles";
import { ExplorerPluginTabMenu } from "./ExplorerPluginTabMenu";
import { useNavigate } from "react-router-dom";
import { openTransfersTab } from "./tabPaths";

const transferBadgeStatuses = new Set<TransferRecord["status"]>([
  "queued",
  "pending",
  "in_progress",
  "waiting_for_resolution",
  "failed",
  "interrupted",
]);
const emptyTransferRows: TransferRecord[] = [];

export function ExplorerTray(props: {
  terminalEnabled: boolean;
  terminalPath: string;
  commands: PluginCommandEntry[];
  panels: PluginPanelEntry[];
  selectedPath: string;
  onToggleFileManagerMode: () => void;
}) {
  const openTerminal = useCallback(() => {
    if (!props.terminalEnabled) return;
    void openTerminalAtPath(props.terminalPath).catch((error: unknown) => {
      useExplorerStore
        .getState()
        .pushNotification(`Terminal unavailable: ${errorText(error)}`, "error", 4500);
    });
  }, [props.terminalEnabled, props.terminalPath]);

  return (
    <>
      <Button
        className={explorerTrayStyles.trigger}
        type="button"
        title="Open Spaces"
        aria-label="Open Spaces"
        onClick={props.onToggleFileManagerMode}
      >
        <PanelsTopLeft size={16} />
      </Button>
      <span className="mx-0.5 h-4 w-px bg-charcoal-border" aria-hidden="true" />
      <ExplorerPluginTabMenu
        commands={props.commands}
        panels={props.panels}
        selectedPath={props.selectedPath}
      />
      <ExplorerTransfersTabButton />
      <Button
        className={explorerTrayStyles.trigger}
        type="button"
        title={props.terminalEnabled ? "Open terminal" : "Terminal unavailable for this view"}
        aria-label="Open terminal"
        disabled={!props.terminalEnabled}
        onClick={openTerminal}
      >
        <Terminal size={16} />
      </Button>
    </>
  );
}

/**
 * The transfer badge, kept in the file manager toolbar because that is where
 * transfers get started. Transfers itself is a workspace tool now, so this
 * opens that tab rather than a panel inside this one.
 */
export function ExplorerTransfersTabButton() {
  const navigate = useNavigate();
  const rows = useTransfersStore((state) => state.transfers?.rows ?? emptyTransferRows);
  const activityItems = useActivityStore((state) => state.allItems);
  const activeTransferCount = rows.filter((row) => transferBadgeStatuses.has(row.status)).length;
  const newTransferCount = unreadActivityCountForTool(activityItems, "transfers");
  const badgeCount = newTransferCount || activeTransferCount;
  const openTransfers = () => {
    const activity = useActivityStore.getState();
    for (const item of activity.allItems) {
      if (
        !item.readAt &&
        item.target.kind === "workspace-tool" &&
        item.target.tool === "transfers"
      ) {
        activity.markRead(item.id);
      }
    }
    navigate(openTransfersTab().route);
  };
  return (
    <span className={explorerTrayStyles.triggerWrap}>
      <Button
        className={explorerTrayStyles.trigger}
        type="button"
        title="Transfers"
        aria-label={newTransferCount ? `Transfers, ${newTransferCount} new` : "Transfers"}
        onClick={openTransfers}
      >
        <ArrowRightLeft size={16} />
      </Button>
      {badgeCount > 0 ? (
        <span className={explorerTrayStyles.badge}>{formatTransferBadgeCount(badgeCount)}</span>
      ) : null}
    </span>
  );
}

export function formatTransferBadgeCount(count: number): string {
  return count > 99 ? "99+" : String(count);
}
