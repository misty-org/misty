import { AgentJobWorker } from "@/features/agents";
import { WorkflowSchedulesBridge } from "@/features/agents";
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
      <DeferUntilIdle>
        <MistyContextBridgeHost />
        <WorkflowSchedulesBridge />
        <AgentJobWorker />
      </DeferUntilIdle>
    </>
  );
}
