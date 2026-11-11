import { AgentJobWorker } from "@/features/agents";
import { WorkflowSchedulesBridge } from "@/features/agents";
import { AutofillChooser } from "@/features/browser";
import { MistyContextBridgeHost } from "@/features/agents";
import { BrowserContextMenuBridge } from "@/features/agents";
import { BrowserRuntimeBridge } from "@/features/browser";
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
