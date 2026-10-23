import { AgentJobWorker } from "@/features/agents/AgentJobWorker";
import { WorkflowSchedulesBridge } from "@/features/agents";
import { BrowserSearchDialog } from "@/features/browser-sync/BrowserSearchDialog";
import { MistyContextBridgeHost } from "@/features/misty/MistyContextBridgeHost";
import { BrowserContextMenuBridge } from "@/features/misty/BrowserContextMenuBridge";
import { FirstRunSetup } from "@/features/setup";
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
        <FirstRunSetup />
      </DeferUntilIdle>
    </>
  );
}
