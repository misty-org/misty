import { AgentJobWorker } from "@/features/agents/AgentJobWorker";
import { WorkflowSchedulesBridge } from "@/features/agents";
import { AutofillChooser } from "@/features/autofill/AutofillChooser";
import { BrowserSearchDialog } from "@/features/browser-search/BrowserSearchDialog";
import { MistyContextBridgeHost } from "@/features/misty/MistyContextBridgeHost";
import { BrowserContextMenuBridge } from "@/features/misty/BrowserContextMenuBridge";
import { BrowserRuntimeBridge } from "@/features/webviews/BrowserRuntimeBridge";
import { DeferUntilIdle } from "./DeferUntilIdle";
import { SettingsOverlay } from "./SettingsOverlays";

/** Overlays and background bridges mounted beside the route shell. */
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
      <AutofillChooser />
      <DeferUntilIdle>
        <MistyContextBridgeHost />
        <WorkflowSchedulesBridge />
        <AgentJobWorker />
      </DeferUntilIdle>
    </>
  );
}
