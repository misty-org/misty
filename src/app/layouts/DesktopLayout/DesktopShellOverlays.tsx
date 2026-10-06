import { AgentJobWorker } from "@/features/agents/AgentJobWorker";
import { WorkflowSchedulesBridge } from "@/features/agents";
import { BrowserSearchDialog } from "@/features/browser-workspace/BrowserSearchDialog";
import { MistyContextBridgeHost } from "@/features/misty/MistyContextBridgeHost";
import { BrowserContextMenuBridge } from "@/features/global-search/BrowserContextMenuBridge";
import { FirstRunSetup } from "@/features/setup";
import { BrowserRuntimeBridge } from "@/features/webviews/BrowserRuntimeBridge";
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
      {props.userId ? <MistyContextBridgeHost /> : null}
      <BrowserSearchDialog />
      <BrowserRuntimeBridge />
      <BrowserContextMenuBridge />
      <WorkflowSchedulesBridge />
      <AgentJobWorker />
      <FirstRunSetup />
    </>
  );
}
