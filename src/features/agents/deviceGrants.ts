import type { AiInvocationDeviceContext } from "@/features/ai-surface/types";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { agentsDeviceSnapshot } from "./store/useAgentsStore";
import { deviceAccount, ensureServerAgentDevice } from "./store/useAgentDeviceStore";
import { devicesNative } from "@/native/devices";

/** Each device's Misty browser has its own grant reference. */
export const workspaceGrantRef = (deviceId: string) => `workspace:${deviceId}`;
/** Where files another of the person's devices sends this one arrive. */
export const inboxGrantRef = (deviceId: string) => `inbox:${deviceId}`;

const folderCapabilities = ["files.list", "files.read", "files.send"];
const workspaceCapabilities = ["tabs.list", "tabs.open", "bookmarks.list", "bookmarks.add"];

/** Another of the person's devices picked for this chat, as its own signed
 * policy describes it (docs/design/devices/BRIEF.md). */
export interface RemoteAgentDevice {
  deviceId: string;
  name: string;
  agentSurfaces: string[];
  sharedFolders: { scopeId: string; name: string }[];
}

/**
 * Grants a desktop chat carries to the server: every folder the person shared
 * with agents on this computer and the Misty browser, this computer's inbox,
 * and whatever the picked devices' own policies allow. Each is signed by this
 * device when the chat is sent, and each target checks it before acting.
 */
export async function desktopDeviceGrants(
  remote: RemoteAgentDevice[] = [],
): Promise<AiInvocationDeviceContext[]> {
  if (!hasTauriInternals()) return [];
  const local = await agentsDeviceSnapshot().catch(() => null);
  if (!local?.device || local.device.status === "revoked") return [];
  const device = await ensureServerAgentDevice(local.device).catch(() => null);
  if (!device) return [];
  // Only a device added to the account takes part in agent work.
  const account = await deviceAccount().catch(() => null);
  const view = account ? await devicesNative.view(account.accountId).catch(() => null) : null;
  if (!view?.admitted) return [];
  const folders = local.scopes
    .filter((scope) => scope.kind === "local_folder" && scope.available)
    .map((scope): AiInvocationDeviceContext => ({
      deviceId: device.id,
      kind: "local_folder",
      opaqueRef: scope.id,
      displayName: scope.displayName,
      capabilities: folderCapabilities,
      metadata: { source: "shared-folder" },
    }));
  const contexts: AiInvocationDeviceContext[] = [
    ...folders,
    {
      deviceId: device.id,
      kind: "workspace",
      opaqueRef: workspaceGrantRef(device.id),
      displayName: "Misty browser",
      capabilities: workspaceCapabilities,
      metadata: { source: "desktop" },
    },
  ];
  if (remote.length) {
    contexts.push({
      deviceId: device.id,
      kind: "inbox",
      opaqueRef: inboxGrantRef(device.id),
      displayName: "Misty downloads",
      capabilities: ["files.receive"],
      metadata: { source: "desktop" },
    });
  }
  for (const target of remote) {
    if (target.deviceId === device.id) continue;
    if (target.agentSurfaces.includes("folders")) {
      for (const folder of target.sharedFolders) {
        contexts.push({
          deviceId: target.deviceId,
          kind: "local_folder",
          opaqueRef: folder.scopeId,
          displayName: folder.name,
          capabilities: folderCapabilities,
          metadata: { source: "device" },
        });
      }
    }
    if (target.agentSurfaces.includes("browser")) {
      contexts.push({
        deviceId: target.deviceId,
        kind: "workspace",
        opaqueRef: workspaceGrantRef(target.deviceId),
        displayName: `Misty browser on ${target.name}`,
        capabilities: workspaceCapabilities,
        metadata: { source: "device" },
      });
    }
  }
  return contexts;
}
