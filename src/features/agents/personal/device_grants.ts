import type { AiInvocationDeviceContext } from "../runs/invocations/invocation_types";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { adoptFolderChanges, agentsDeviceSnapshot } from "./use_agents_store";
import { ensureAgentDevice } from "./use_agent_device_store";
import { useConversationFolder } from "../shared-folders/use_conversation_folder";

const workspaceGrantRef = (deviceId: string) => `workspace:${deviceId}`;

const folderCapabilities = ["folder.list", "folder.read", "folder.send"];
const workspaceCapabilities = ["browser.session", "browser.run", "shell.run"];

export async function desktopDeviceGrants(
  folderId: string | null = null,
  folderWritable = false,
): Promise<AiInvocationDeviceContext[]> {
  if (!hasTauriInternals()) return [];
  const local = await agentsDeviceSnapshot().catch(() => null);
  if (!local?.device || local.device.status === "revoked") return [];
  const device = await ensureAgentDevice(local.device).catch(() => null);
  if (!device) return [];
  const folders = local.scopes
    .filter((scope) => scope.id === folderId && scope.available)
    .map((scope): AiInvocationDeviceContext => ({
      deviceId: device.id,
      kind: "local_folder",
      opaqueRef: scope.id,
      displayName: scope.displayName,
      capabilities: folderWritable ? [...folderCapabilities, "folder.write"] : folderCapabilities,
      metadata: { source: "shared-folder" },
    }));
  return [
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
}

export async function chatDeviceGrants(
  conversationId: string,
  startsConversation: boolean,
): Promise<AiInvocationDeviceContext[]> {
  const folders = useConversationFolder.getState();
  const folder = folders.folder(conversationId) ?? (startsConversation ? folders.draft : null);
  if (startsConversation) {
    await adoptFolderChanges("draft", conversationId).catch(() => undefined);
    folders.adoptDraft(conversationId);
  }
  return desktopDeviceGrants(
    folder,
    folder ? folders.writable(folder, conversationId) : false,
  ).catch(() => []);
}
