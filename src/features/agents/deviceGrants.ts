import type { AiInvocationDeviceContext } from "@/features/ai-surface/types";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { agentsDeviceSnapshot } from "./store/useAgentsStore";
import { ensureServerAgentDevice } from "./store/useAgentDeviceStore";
import { useConversationProject } from "./store/useConversationProject";

/** The Misty browser's grant reference on this computer. */
const workspaceGrantRef = (deviceId: string) => `workspace:${deviceId}`;

const folderCapabilities = ["folder.list", "folder.read", "folder.send"];
/** Projects: coding through the person's own coding tool, on this computer
 * only, plus reading documents and sending files to the Space Library the way
 * read-only folders do. */
export const projectCapabilities = [...folderCapabilities, "code.delegate"];
/** The agent may open its own browser session on this computer: a hidden tab of its
 * own that joins the run (docs/plans/odysseys-campaign.md). */
const workspaceCapabilities = [
  "browser.tab.list",
  "browser.tab.open",
  "bookmark.list",
  "bookmark.add",
  "web.fetch",
  "browser.session",
  // Programs against the agent's own tabs (docs/plans/agent-harness-v3.md, change 1).
  "browser.run",
];

/**
 * Grants a desktop chat carries to the server: the project picked for the
 * chat (if any) and the Misty browser. An agent run works on the computer the
 * person sent it from, never another device. Each grant is signed by this
 * device when the chat is sent, and this device checks it before acting.
 */
export async function desktopDeviceGrants(
  projectId: string | null = null,
): Promise<AiInvocationDeviceContext[]> {
  if (!hasTauriInternals()) return [];
  const local = await agentsDeviceSnapshot().catch(() => null);
  if (!local?.device || local.device.status === "revoked") return [];
  const device = await ensureServerAgentDevice(local.device).catch(() => null);
  if (!device) return [];
  // Only the chat's own project travels; a folder still shared read-only
  // (from before projects) gets the read-only folder tools.
  const picked = local.scopes.filter((scope) => scope.id === projectId && scope.available);
  const folders = picked
    .filter((scope) => scope.kind === "local_folder")
    .map((scope): AiInvocationDeviceContext => ({
      deviceId: device.id,
      kind: "local_folder",
      opaqueRef: scope.id,
      displayName: scope.displayName,
      capabilities: folderCapabilities,
      metadata: { source: "shared-folder" },
    }));
  const projects = picked
    .filter((scope) => scope.kind === "project_folder")
    .map((scope): AiInvocationDeviceContext => ({
      deviceId: device.id,
      kind: "project_folder",
      opaqueRef: scope.id,
      displayName: scope.displayName,
      capabilities: projectCapabilities,
      metadata: { source: "project" },
    }));
  return [
    ...folders,
    ...projects,
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
 * The grants for one chat message: its conversation's project (a new chat's
 * draft choice, which the new conversation adopts) and this computer's
 * browser. A failure sends no grants rather than blocking the message.
 */
export async function chatDeviceGrants(
  conversationId: string,
  startsConversation: boolean,
): Promise<AiInvocationDeviceContext[]> {
  const projects = useConversationProject.getState();
  const project = projects.project(conversationId) ?? (startsConversation ? projects.draft : null);
  if (startsConversation) projects.adoptDraft(conversationId);
  return desktopDeviceGrants(project).catch(() => []);
}
