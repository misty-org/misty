import type { AiInvocationDeviceContext } from "@/features/ai-surface/types";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { adoptFolderChanges, agentsDeviceSnapshot } from "./store/useAgentsStore";
import { ensureServerAgentDevice } from "./store/useAgentDeviceStore";
import { useConversationFolder } from "./store/useConversationFolder";

/** The Misty browser's grant reference on this computer. */
const workspaceGrantRef = (deviceId: string) => `workspace:${deviceId}`;

const folderCapabilities = ["folder.list", "folder.read", "folder.send"];
/** The agent may open its own browser session on this computer: a hidden tab of its
 * own that joins the run (docs/agents/evals/odysseys.md). */
const workspaceCapabilities = [
  "browser.tab.list",
  "browser.tab.open",
  "bookmark.list",
  "bookmark.add",
  "browser.session",
  // Programs against the agent's own tabs (docs/agents/harness.md, browser_run).
  "browser.run",
  // Commands in the chat's private workspace (docs/plans/app-permissions.md).
  "shell.run",
];

/**
 * Grants a desktop chat carries to the server: the shared folder picked for
 * the chat (if any) and the Misty browser. An agent run works on the computer the
 * person sent it from, never another device. Each grant is signed by this
 * device when the chat is sent, and this device checks it before acting.
 */
export async function desktopDeviceGrants(
  folderId: string | null = null,
  folderWritable = false,
): Promise<AiInvocationDeviceContext[]> {
  if (!hasTauriInternals()) return [];
  const local = await agentsDeviceSnapshot().catch(() => null);
  if (!local?.device || local.device.status === "revoked") return [];
  const device = await ensureServerAgentDevice(local.device).catch(() => null);
  if (!device) return [];
  // Only the chat's own folder travels.
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

/**
 * The grants for one chat message: its conversation's folder (a new chat's
 * draft choice, which the new conversation adopts) and this computer's
 * browser. A failure sends no grants rather than blocking the message.
 */
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
  return desktopDeviceGrants(folder, folder ? folders.writable(folder, conversationId) : false).catch(
    () => [],
  );
}
