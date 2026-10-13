import type { AiInvocationDeviceContext } from "@/features/ai-surface/types";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { agentsDeviceSnapshot } from "./store/useAgentsStore";
import { deviceAccount, ensureServerAgentDevice } from "./store/useAgentDeviceStore";
import { devicesNative } from "@/native/devices";
import { useAgentDeviceTargets } from "./store/useAgentDeviceTargets";
import { useConversationProject } from "./store/useConversationProject";

/** Each device's Misty browser has its own grant reference. */
const workspaceGrantRef = (deviceId: string) => `workspace:${deviceId}`;

const folderCapabilities = ["files.list", "files.read", "files.send"];
/** Projects: the code tools, on this computer only, plus reading documents
 * and sending files to the Space Library the way read-only folders do. */
export const projectCapabilities = [
  ...folderCapabilities,
  "code.read",
  "code.list",
  "code.find",
  "code.search",
  "code.write",
  "code.edit",
  "code.run",
  "code.start",
  "code.logs",
  "code.processes",
  "code.stop",
  "code.preview",
  "git.status",
  "git.diff",
  "git.log",
  "git.commit",
  "git.branch",
  "git.push",
  "git.pull",
  "git.pull_request",
];
const workspaceCapabilities = ["tabs.list", "tabs.open", "bookmarks.list", "bookmarks.add"];
/** On another device the agent may also open its own browser session there. */
const remoteWorkspaceCapabilities = [...workspaceCapabilities, "browser.session"];

/** Another of the person's devices picked for this chat, as its own signed
 * policy describes it (docs/design/devices/BRIEF.md). */
export interface RemoteAgentDevice {
  deviceId: string;
  name: string;
  agentSurfaces: string[];
  sharedFolders: { scopeId: string; name: string }[];
}

/**
 * Grants a desktop chat carries to the server: the project picked for the
 * chat (if any), the Misty browser, and whatever the
 * picked devices' own policies allow. Each is signed by this device when the
 * chat is sent, and each target checks it before acting.
 */
export async function desktopDeviceGrants(
  remote: RemoteAgentDevice[] = [],
  projectId: string | null = null,
): Promise<AiInvocationDeviceContext[]> {
  if (!hasTauriInternals()) return [];
  const local = await agentsDeviceSnapshot().catch(() => null);
  if (!local?.device || local.device.status === "revoked") return [];
  const device = await ensureServerAgentDevice(local.device).catch(() => null);
  if (!device) return [];
  // Agents may always use the computer the person is at. Reaching other
  // devices needs this one added to the account (with Sync or approval).
  const account = await deviceAccount().catch(() => null);
  const view = account ? await devicesNative.view(account.accountId).catch(() => null) : null;
  const targets = view?.admitted ? remote : [];
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
  const contexts: AiInvocationDeviceContext[] = [
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
  for (const target of targets) {
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
        capabilities: remoteWorkspaceCapabilities,
        metadata: { source: "device" },
      });
    }
  }
  return contexts;
}

/**
 * The grants for one chat message: its conversation's project (a new chat's
 * draft choice, which the new conversation adopts) and the devices picked in
 * the composer. A failure sends no grants rather than blocking the message.
 */
export async function chatDeviceGrants(
  conversationId: string,
  startsConversation: boolean,
): Promise<AiInvocationDeviceContext[]> {
  const projects = useConversationProject.getState();
  const project = projects.project(conversationId) ?? (startsConversation ? projects.draft : null);
  if (startsConversation) projects.adoptDraft(conversationId);
  const targets = useAgentDeviceTargets.getState().targets;
  return desktopDeviceGrants(targets, project).catch(() => []);
}
