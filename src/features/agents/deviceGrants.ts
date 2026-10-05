import type { AiInvocationDeviceContext } from "@/features/ai-surface/types";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { agentsDeviceSnapshot } from "./store/useAgentsStore";
import { ensureServerAgentDevice } from "./store/useAgentDeviceStore";

export const workspaceGrantRef = "workspace:misty-browser";

/**
 * Grants a desktop chat carries to the server: every folder the person shared
 * with agents on this computer (read only) and the Misty browser's tabs and
 * bookmarks. The server offers matching tools only for grants it receives, and
 * this computer re-checks each one when a job runs.
 */
export async function desktopDeviceGrants(): Promise<AiInvocationDeviceContext[]> {
  if (!hasTauriInternals()) return [];
  const local = await agentsDeviceSnapshot().catch(() => null);
  if (!local?.device || local.device.status === "revoked") return [];
  const device = await ensureServerAgentDevice(local.device).catch(() => null);
  if (!device) return [];
  const folders = local.scopes
    .filter((scope) => scope.kind === "local_folder" && scope.available)
    .map((scope): AiInvocationDeviceContext => ({
      deviceId: device.id,
      kind: "local_folder",
      opaqueRef: scope.id,
      displayName: scope.displayName,
      capabilities: ["files.list", "files.read"],
      metadata: { source: "shared-folder" },
    }));
  return [
    ...folders,
    {
      deviceId: device.id,
      kind: "workspace",
      opaqueRef: workspaceGrantRef,
      displayName: "Misty browser",
      capabilities: ["tabs.list", "tabs.open", "bookmarks.list", "bookmarks.add"],
      metadata: { source: "desktop" },
    },
  ];
}
