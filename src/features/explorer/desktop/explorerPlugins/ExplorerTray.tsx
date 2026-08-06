import { Button } from "@/ui";
import { ArrowRightLeft, PanelsTopLeft, Terminal } from "lucide-react";
import { useCallback } from "react";
import { openTerminalAtPath } from "@/stores/backend";
import type { PluginCommandEntry, PluginPanelEntry } from "@/models/interfaces/services/misty-api";
import { useMultiPanelStore } from "@/features/workspace";
import { errorText } from "@/lib/format";
import { useExplorerStore } from "@/stores/explorer";
import { useTransfersStore } from "@/stores/transfers";
import { cx } from "../ExplorerDesktopShared";
import { explorerTrayStyles } from "../ExplorerDesktopPluginStyles";
import { ExplorerPluginTabMenu } from "./ExplorerPluginTabMenu";
import { isTransfersTabPath } from "./tabPaths";
import type { TransferRecord } from "@/models/interfaces/services/misty-api";

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
  onOpenTransfers: () => void;
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
      <ExplorerTransfersTabButton onClick={props.onOpenTransfers} />
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

export function ExplorerTransfersTabButton(props: { onClick: () => void }) {
  const rows = useTransfersStore((state) => state.transfers?.rows ?? emptyTransferRows);
  const active = useMultiPanelStore((state) => {
    const tab = state.tabs.find((candidate) => candidate.id === state.activeTabId);
    return Boolean(tab && isTransfersTabPath(tab.path));
  });
  const badgeCount = rows.filter((row) => transferBadgeStatuses.has(row.status)).length;
  return (
    <span className={explorerTrayStyles.triggerWrap}>
      <Button
        className={cx(explorerTrayStyles.trigger, active && explorerTrayStyles.triggerActive)}
        type="button"
        title="Transfers"
        aria-label="Transfers"
        onClick={props.onClick}
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
