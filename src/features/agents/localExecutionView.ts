import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { browserHomeUrl } from "@/features/workspace/browserHome";
import { browserTabAgentFileCapabilities } from "./browserTabCapabilities";
import type { Execution } from "./localExecutionState";
import { agentsDeviceSnapshot } from "./store/useAgentsStore";
import { ensureServerAgentDevice } from "./store/useAgentDeviceStore";

/** Opens the task's own hidden browser view and attaches it as the task's screen. */
export async function createWorkspaceView(
  execution: Execution,
  assertCurrent: () => void,
  created: (id: string) => void,
) {
  const snapshot = await agentsDeviceSnapshot();
  assertCurrent();
  if (!snapshot.device) throw new Error("This device is unavailable for agent execution.");
  const device = await ensureServerAgentDevice(snapshot.device);
  assertCurrent();
  const id = `agent-${crypto.randomUUID()}`;
  const scopeId = `agent-scope-${crypto.randomUUID()}`;
  await invoke("browser_webview_create", {
    request: {
      id,
      scopeId,
      // Desktop control uses this inert view only as the existing device
      // operation/grant carrier. It never navigates a hidden task browser.
      url: execution.desktopControl ? "about:blank" : browserHomeUrl(),
      originSpaceId: execution.spaceId,
      x: 0,
      y: 64,
      width: Math.max(200, window.innerWidth - 440),
      height: Math.max(300, window.innerHeight - 128),
      theme: "dark",
    },
  });
  // A native create can finish after cancellation/account switching. Close
  // that exact view before propagating the stale-start error.
  try {
    assertCurrent();
  } catch (error) {
    await invoke("browser_webview_close", { request: { id } });
    throw error;
  }
  created(id);
  execution.views.push(id);
  await invoke("agent_workspace_bind_scope", { taskId: execution.taskId, scopeId });
  assertCurrent();
  await invoke("browser_webview_hide", { request: { id } });
  assertCurrent();
  execution.context.push({
    kind: "browser-tab",
    id: "browser:workspace",
    title: execution.desktopControl ? "Desktop" : "Browser",
    source: "current",
    privacy: "device",
    spaceId: execution.spaceId,
    opaqueScopeId: scopeId,
    attached: true,
    metadata: { app_id: "browser" },
  });
  execution.deviceContexts.push({
    deviceId: device.id,
    kind: "browser_tab",
    opaqueRef: scopeId,
    displayName: execution.desktopControl ? "Desktop screen control" : "Browser workspace",
    // Desktop and Misty-window screens act through browser_act goals with
    // Misty's own cursor. Browser tabs are read as text and acted on by ref.
    capabilities: execution.autopilot
      ? ["browser.workspace.visual", "browser.act"]
      : browserTabAgentFileCapabilities,
    metadata: {
      ...(execution.autopilot ? { workspace_control: true } : {}),
      ...(execution.desktopControl ? { desktop_control: true } : {}),
      app_id: "browser",
      window_label: getCurrentWindow().label,
    },
  });
}
