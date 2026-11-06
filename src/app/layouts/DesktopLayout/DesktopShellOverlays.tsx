import { AgentJobWorker } from "@/features/agents/AgentJobWorker";
import { WorkflowSchedulesBridge } from "@/features/agents";
import { BrowserSearchDialog } from "@/features/browser-search/BrowserSearchDialog";
import { MistyContextBridgeHost } from "@/features/misty/MistyContextBridgeHost";
import { BrowserContextMenuBridge } from "@/features/misty/BrowserContextMenuBridge";
import { BrowserRuntimeBridge } from "@/features/webviews/BrowserRuntimeBridge";
import { DeferUntilIdle } from "./DeferUntilIdle";
import { SettingsOverlay } from "./SettingsOverlays";

/** Signed-in overlays and background bridges mounted beside the route shell. */
export function DesktopShellOverlays(props: {
  settingsOpen: boolean;
  onCloseSettings: () => void;
  userId: string | undefined;
}) {
  return (
    <>
      <SettingsOverlay open={props.settingsOpen} onClose={props.onCloseSettings} />
      <BrowserSearchDialog />
      <BrowserRuntimeBridge />
      <BrowserContextMenuBridge />
      <DeferUntilIdle>
        {props.userId ? <MistyContextBridgeHost /> : null}
        <WorkflowSchedulesBridge />
        <AgentJobWorker />
      </DeferUntilIdle>
    </>
  );
}
