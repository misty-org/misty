import { devicesApi } from "@/features/devices";
import { preferredDefaultSpace, spacesSnapshot } from "@/features/app-windows";
import { agentsDeviceSnapshot } from "../personal/useAgentsStore";
import {
  argumentsInvalid,
  computerToolFailure,
  invalidRequest,
  notAllowed,
} from "./deviceFailures";
import { buildDeviceJob, settleDeviceJob } from "./deviceJob";
import { LocalToolRejected, type LocalToolRequest } from "./host";
import { contextFor, type RunDeviceContext, type RunEntry } from "./runContexts";

/**
 * The grants a desktop chat attaches beyond its screens: shared folders, the Misty browser's tabs and
 * bookmarks, and commands in the chat's workspace (`device_agent_tools.go`). Each call runs as a job
 * under its grant, which native code checks again before acting.
 */

async function thisComputerName(): Promise<string> {
  const snapshot = await agentsDeviceSnapshot().catch(() => null);
  return snapshot?.device?.displayName?.trim() ?? "";
}

async function runComputerTool(
  request: LocalToolRequest,
  entry: RunEntry,
  scopeId: string,
  input: Record<string, unknown>,
) {
  const name = request.name;
  const context = contextFor(entry, scopeId, name);
  if (!context) throw new LocalToolRejected("device_unavailable", "the user's computer is offline");
  const outcome = await settleDeviceJob(
    buildDeviceJob({
      entry,
      context,
      callId: request.callId,
      node: "device_tool",
      operation: name,
      input,
      config: { agentId: entry.agentId },
    }),
    request.signal,
  );
  if (!outcome.ok) throw computerToolFailure(name, outcome.error, outcome.stopped);
  return outcome.output;
}

function cleanPath(value: unknown): string {
  const path = (typeof value === "string" ? value : "").trim().replace(/^\/+|\/+$/g, "");
  if (`/${path}/`.includes("/../")) throw invalidRequest("use a path inside the folder");
  return path;
}

/** A shared folder by its scope, its label, or a name only one folder has. */
async function resolveFolder(entry: RunEntry, value: unknown) {
  const folders = entry.contexts.filter((item) => item.kind === "local_folder");
  if (!folders.length) throw notAllowed();
  const computer = await thisComputerName();
  const label = (folder: RunDeviceContext) =>
    computer ? `${folder.displayName} (${computer})` : folder.displayName;
  const wanted = (typeof value === "string" ? value : "").trim();
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const exact = folders.find((item) => item.opaqueRef === wanted || same(label(item), wanted));
  const named = folders.filter((item) => same(item.displayName, wanted));
  const folder = exact ?? (named.length === 1 ? named[0] : undefined);
  if (!folder) {
    throw invalidRequest(
      `no shared folder ${wanted}; shared folders: ${folders.map(label).join(", ")}`,
    );
  }
  return folder;
}

export async function runFolderRead(request: LocalToolRequest, entry: RunEntry) {
  const folder = await resolveFolder(entry, request.input.folder);
  return runComputerTool(request, entry, folder.opaqueRef, {
    scopeId: folder.opaqueRef,
    relativePath: cleanPath(request.input.path),
  });
}

/** The Space a sent file lands in: the run's, or the person's own for a run that names none. */
async function withDestination(entry: RunEntry): Promise<RunEntry> {
  if (entry.spaceId) return entry;
  return { ...entry, spaceId: preferredDefaultSpace(spacesSnapshot().spaces)?.id ?? "" };
}

export async function runFolderSend(request: LocalToolRequest, entry: RunEntry) {
  const folder = await resolveFolder(entry, request.input.folder);
  let path: string;
  try {
    path = cleanPath(request.input.path);
  } catch {
    path = "";
  }
  if (!path) throw invalidRequest("name a file inside the folder");
  return runComputerTool(request, await withDestination(entry), folder.opaqueRef, {
    scopeId: folder.opaqueRef,
    relativePath: path,
  });
}

/** The Misty browser this call means: the only one, or the computer it names. */
async function resolveWorkspace(entry: RunEntry, wanted: unknown) {
  const workspaces = entry.contexts.filter((item) => item.kind === "workspace");
  if (!workspaces.length) throw notAllowed();
  if (workspaces.length === 1) return workspaces[0];
  const computer = await thisComputerName();
  const name = (typeof wanted === "string" ? wanted : "").trim();
  const found = workspaces.find(
    (item) => item.deviceId === name || (computer && computer.toLowerCase() === name.toLowerCase()),
  );
  if (!found) throw invalidRequest(`name the computer: ${computer}`);
  return found;
}

/** The tab list and bookmarks. */
export async function runWorkspaceTool(request: LocalToolRequest, entry: RunEntry) {
  const workspace = await resolveWorkspace(entry, request.input.device);
  const input = Object.fromEntries(
    Object.entries(request.input).filter(([key]) => key !== "device"),
  );
  return runComputerTool(request, entry, workspace.opaqueRef, input);
}

/** A command in the chat's workspace. The computer takes the workspace from the signed grant. */
export async function runShellTool(request: LocalToolRequest, entry: RunEntry) {
  const command = request.input.command;
  if (typeof command !== "string" || !command.trim()) throw argumentsInvalid();
  const workspace = await resolveWorkspace(entry, request.input.device);
  const folder = entry.contexts.find(
    (item) => item.kind === "local_folder" && item.deviceId === workspace.deviceId,
  );
  const seconds = request.input.timeout_seconds;
  return runComputerTool(request, entry, workspace.opaqueRef, {
    command,
    ...(typeof seconds === "number" && seconds > 0 ? { timeoutSeconds: seconds } : {}),
    ...(folder ? { folderScopeId: folder.opaqueRef } : {}),
  });
}

interface AccountDeviceRow {
  id: string;
  name: string;
  platform: string;
  lastSeenAt: string;
  admissionState?: string;
}

/** The account's signed-in devices, from the normal signed-in API. */
export async function runDeviceList() {
  const answer = await devicesApi.list<{ devices: AccountDeviceRow[] }>().catch(() => {
    throw new LocalToolRejected(
      "device_list_unavailable",
      "Misty could not complete this tool call.",
    );
  });
  return {
    devices: (answer.devices ?? [])
      .filter((device) => device.admissionState !== "revoked")
      .map((device) => ({
        id: device.id,
        name: device.name,
        platform: device.platform,
        last_seen: device.lastSeenAt,
      })),
  };
}
