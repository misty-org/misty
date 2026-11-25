import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { browserHomeUrl } from "@/features/app-windows";
import { agentPageBounds } from "../../tabs/agent_tab_records";
import { browserTabAgentFileCapabilities } from "../../tabs/browser_tab_capabilities";
import type { Execution } from "./local_execution_state";
import { agentsDeviceSnapshot } from "../../personal/use_agents_store";
import { ensureAgentDevice } from "../../personal/use_agent_device_store";

export async function createWorkspaceView(
  execution: Execution,
  assertCurrent: () => void,
  created: (id: string) => void,
) {
  const snapshot = await agentsDeviceSnapshot();
  assertCurrent();
  if (!snapshot.device) throw new Error("This signed-in session is unavailable for agents.");
  const device = await ensureAgentDevice(snapshot.device);
  assertCurrent();
  const id = `agent-${crypto.randomUUID()}`;
  const scopeId = `agent-scope-${crypto.randomUUID()}`;
  await invoke("browser_webview_create", {
    request: {
      id,
      scopeId,
      url: execution.desktopControl ? "about:blank" : browserHomeUrl(),
      originSpaceId: execution.spaceId,
      ...agentPageBounds(),
    },
  });
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
