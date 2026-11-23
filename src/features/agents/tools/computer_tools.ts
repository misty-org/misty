import { preferredDefaultSpace, spacesSnapshot } from "@/features/app-windows";
import { agentsDeviceSnapshot } from "../personal/use_agents_store";
import {
  argumentsInvalid,
  computerToolFailure,
  invalidRequest,
  notAllowed,
} from "./device_failures";
import { buildDeviceJob, settleDeviceJob } from "./device_job";
import { LocalToolRejected, type LocalToolRequest } from "./host";
import { contextFor, type RunDeviceContext, type RunEntry } from "./run_contexts";

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

function resolveWorkspace(entry: RunEntry) {
  const workspace = entry.contexts.find((item) => item.kind === "workspace");
  if (!workspace) throw notAllowed();
  return workspace;
}

export async function runShellTool(request: LocalToolRequest, entry: RunEntry) {
  const command = request.input.command;
  if (typeof command !== "string" || !command.trim()) throw argumentsInvalid();
  const workspace = resolveWorkspace(entry);
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
