import { invoke } from "@tauri-apps/api/core";
import { spacesGateway } from "../spaces-gateway/spaces_gateway";
import { devicesNative } from "@/features/devices";
import { agentsPrepareScopedDocument } from "./use_agents_store";
import type { ClaimedWorkflowNodeJob } from "../runs/jobs/worker_browser_jobs";

export const deviceAgentOperations = new Set([
  "folder.list",
  "folder.read",
  "folder.send",
  "shell.run",
]);

const readLimit = 20_000;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function scopedPath(job: ClaimedWorkflowNodeJob["job"]) {
  const input = record(job.input);
  const relativePath = typeof input.relativePath === "string" ? input.relativePath : "";
  if (
    input.scopeId !== job.scopeId ||
    relativePath.startsWith("/") ||
    relativePath.split(/[\\/]/).includes("..")
  )
    throw new Error("invalid_device_scope");
  return { scopeId: job.scopeId, relativePath };
}

export async function runDeviceAgentOperation(
  job: ClaimedWorkflowNodeJob["job"],
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  switch (job.operation) {
    case "folder.send": {
      const target = scopedPath(job);
      if (!target.relativePath) throw new Error("invalid_device_scope");
      if (!job.spaceId) throw new Error("no_space");
      const bytes = await devicesNative.readSharedFile(job.scopeId, job.input, job.config);
      const name = target.relativePath.split(/[\\/]/).filter(Boolean).pop() || "file";
      const saved = await spacesGateway.get().saveToDrive(job.spaceId, "/", name, bytes);
      return { name, size: bytes.byteLength, path: saved.path, fileId: saved.id };
    }
    case "folder.list":
      return invoke<Record<string, unknown>>("agents_list_scoped_files", {
        request: scopedPath(job),
      });
    case "folder.read": {
      const target = scopedPath(job);
      if (!target.relativePath) throw new Error("invalid_device_scope");
      const document = await agentsPrepareScopedDocument(target, signal);
      let text = document.sections.map((section) => section.text).join("\n\n");
      const truncated = document.truncated || text.length > readLimit;
      text = text.slice(0, readLimit);
      return { name: document.displayName, mimeType: document.mimeType, text, truncated };
    }
    case "shell.run": {
      const cancel = () => void invoke("device_shell_cancel", { jobId: job.id }).catch(() => {});
      signal.addEventListener("abort", cancel, { once: true });
      try {
        return await invoke<Record<string, unknown>>("device_shell_job", {
          jobId: job.id,
          scopeId: job.scopeId,
          input: job.input,
          config: job.config,
        });
      } finally {
        signal.removeEventListener("abort", cancel);
      }
    }
  }
  throw new Error(`unsupported_device_operation:${job.operation}`);
}
