import { invoke } from "@tauri-apps/api/core";
import { spacesGateway } from "../spaces-gateway/spacesGateway";
import { devicesNative } from "@/features/devices";
import { agentsPrepareScopedDocument } from "./useAgentsStore";
import type { ClaimedWorkflowNodeJob } from "../runs/jobs/workerBrowserJobs";

/**
 * Device jobs for the grants a desktop chat attached: shared folders (read
 * only) and the chat's shell. Each job names the grant it runs under; a folder
 * job never reaches outside its folder.
 */
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
      // The file is read natively under the job's grant and arrives in the
      // conversation's Space Library as a new item.
      const bytes = await devicesNative.readSharedFile(job.scopeId, job.input, job.config);
      const name = target.relativePath.split(/[\\/]/).filter(Boolean).pop() || "file";
      const uploaded = await spacesGateway
        .get()
        .uploadLibraryBlob(job.spaceId, new Blob([bytes]), name);
      return { name, size: bytes.byteLength, libraryItemId: uploaded.item?.id ?? null };
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
      // Rust checks the job's grant and runs it under its OS profile; this only passes it along.
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
