import { apiBlobRequest } from "@/api/client";
import { invoke } from "@tauri-apps/api/core";

/** Browser node jobs: run-bound grants, requests and task files for the native browser. */

export const browserRuntimeIdForScope = (scopeId: string) =>
  invoke<string>("browser_runtime_for_scope", { scopeId });

/** A device operation that failed before it could have had any effect. */
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
  };
  const input = job.input as {
    attachmentId?: string;
    downloadId?: string;
    sourceScopeId?: string;
  };
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
    // Native resolves the opaque receipt, verifies task ownership and checks
    // its pinned hash. Never accept a model-supplied local path or file bytes.
    return request;
  }
  const file = config.upload;
  if (
    !file ||
    file.id !== (job.input as { attachmentId?: string })?.attachmentId ||
    file.byteSize > 10 * 1024 * 1024
  )
    throw new DeviceOperationNotAttempted("invalid_task_file");
  const blob = await apiBlobRequest(`/misty/attachments/${encodeURIComponent(file.id)}/content`);
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
