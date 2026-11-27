import { localAttachmentFile } from "../../conversations/composer/local_attachments";
import { invoke } from "@tauri-apps/api/core";

export const browserRuntimeIdForScope = (scopeId: string) =>
  invoke<string>("browser_runtime_for_scope", { scopeId });

const fileTypes: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  txt: "text/plain",
  csv: "text/csv",
  json: "application/json",
  html: "text/html",
  md: "text/markdown",
  zip: "application/zip",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  mp4: "video/mp4",
  mov: "video/quicktime",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

const typeOf = (name: string) =>
  fileTypes[name.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";

export class DeviceOperationNotAttempted extends Error {
  constructor(error: unknown) {
    super(error instanceof Error ? error.message : String(error));
  }
}

export interface ClaimedWorkflowNodeJob {
  job: {
    spaceId?: string;
    id: string;
    runId: string;
    nodeId: string;
    callId?: string;
    scopeId: string;
    operation: string;
    contextId?: string;
    attempt: number;
    controlVersion?: number;
    deadlineAt?: string;
    leaseExpiresAt?: string | null;
    cancelRequestedAt?: string | null;
    input: unknown;
    config: unknown;
  };
  leaseToken: string;
  leaseExpiresAt?: string | null;
}

export function jobPolicyCall(config: unknown): string | undefined {
  const value =
    config && typeof config === "object"
      ? (config as { policyCall?: unknown }).policyCall
      : undefined;
  return typeof value === "string" ? value : undefined;
}

export function browserAgentExecutionRequest(job: ClaimedWorkflowNodeJob["job"]) {
  const contextId = job.contextId;
  if (!job.operation.startsWith("browser.") || !contextId || !job.scopeId) {
    throw new Error("invalid_browser_grant");
  }
  const agentId =
    job.config && typeof job.config === "object" && "agentId" in job.config
      ? String(job.config.agentId)
      : "";
  if (!agentId) throw new Error("invalid_browser_grant");
  return {
    scopeId: job.scopeId,
    grantId: `${contextId}:${job.id}`,
    agentId,
    operation: job.operation,
    input: {
      ...(job.input && typeof job.input === "object" ? job.input : {}),
      __mistyTaskId:
        job.config && typeof job.config === "object" && "taskId" in job.config
          ? job.config.taskId
          : undefined,
    },
    policyCall: jobPolicyCall(job.config),
  };
}

export async function registerRunBoundBrowserContext(
  job: ClaimedWorkflowNodeJob["job"],
): Promise<void> {
  const contextId = job.contextId;
  const config =
    job.config && typeof job.config === "object" ? (job.config as Record<string, unknown>) : {};
  const agentId = String(config.agentId || "");
  const capabilities = Array.isArray(config.contextCapabilities)
    ? config.contextCapabilities.map(String)
    : [];
  const expiresAt = String(config.contextExpiresAt || "");
  if (!contextId || !agentId || !expiresAt || !capabilities.includes(job.operation)) {
    throw new Error("invalid_browser_grant");
  }
  const runtimeId = await browserRuntimeIdForScope(job.scopeId).catch(() => null);
  if (!runtimeId) throw new Error("browser_context_closed");
  await invoke("browser_agent_grant_register", {
    request: {
      id: runtimeId,
      scopeId: job.scopeId,
      grantId: `${contextId}:${job.id}`,
      agentId,
      capabilities: [job.operation],
      expiresAt: new Date(
        Math.min(Date.parse(expiresAt), Date.parse(job.deadlineAt ?? "")),
      ).toISOString(),
    },
  });
}

export async function browserDeviceRequest(job: ClaimedWorkflowNodeJob["job"]) {
  const request = browserAgentExecutionRequest(job);
  if (job.operation !== "browser.upload") return request;
  const config = job.config as {
    upload?: { id: string; name: string; mimeType: string; byteSize: number; sha256: string };
    taskId?: string;
    downloadUpload?: { downloadId: string; sourceScopeId: string };
    workingFile?: { runId: string; path: string };
  };
  const input = job.input as {
    attachmentId?: string;
    downloadId?: string;
    sourceScopeId?: string;
    path?: string;
  };
  if (input.path !== undefined || config.workingFile) {
    const working = config.workingFile;
    if (
      !working ||
      working.runId !== job.runId ||
      working.path !== input.path ||
      input.attachmentId ||
      input.downloadId ||
      config.upload ||
      config.downloadUpload
    )
      throw new DeviceOperationNotAttempted("invalid_task_file");
    const found = await invoke<{ name: string; data: string }[]>("space_app_agent_files", {
      runId: working.runId,
      paths: [working.path],
    }).catch(() => {
      throw new DeviceOperationNotAttempted("invalid_task_file");
    });
    const file = found[0];
    const byteSize = file ? atob(file.data).length : 0;
    if (!file || byteSize > 10 * 1024 * 1024)
      throw new DeviceOperationNotAttempted("invalid_task_file");
    const rest: Record<string, unknown> = { ...request.input };
    delete rest.path;
    return {
      ...request,
      input: {
        ...rest,
        file: { name: file.name, mimeType: typeOf(file.name), byteSize, base64: file.data },
      },
    };
  }
  if (input.downloadId || input.sourceScopeId || config.downloadUpload) {
    const source = config.downloadUpload;
    if (
      !config.taskId ||
      !source ||
      input.attachmentId ||
      config.upload ||
      !source.downloadId ||
      !source.sourceScopeId ||
      source.downloadId !== input.downloadId ||
      source.sourceScopeId !== input.sourceScopeId
    )
      throw new DeviceOperationNotAttempted("invalid_task_download");
    return request;
  }
  const file = config.upload;
  if (
    !file ||
    file.id !== (job.input as { attachmentId?: string })?.attachmentId ||
    file.byteSize > 10 * 1024 * 1024
  )
    throw new DeviceOperationNotAttempted("invalid_task_file");
  const blob = await localAttachmentFile(file.id);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  if (bytes.length !== file.byteSize || hash !== file.sha256)
    throw new DeviceOperationNotAttempted("task_file_changed");
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return { ...request, input: { ...request.input, file: { ...file, base64: btoa(binary) } } };
}
