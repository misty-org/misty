import type { FileEntry } from "@/native/contracts";
import type { MistyFileTransferStatus } from "@misty/sdk";
import type { AppRpcScope } from "./rpc/session";
import type { SpacePeerFileAccess } from "./spacePeerFiles";

/** One view owns these jobs. Cancelling a tree discards its unpublished staging directory. */
export function createSpacePeerTransfers(scope: AppRpcScope, files: SpacePeerFileAccess,
  native: (method: string, params?: unknown) => Promise<unknown>) {
  const jobs = new Map<string, { status?: MistyFileTransferStatus; cancel(): void; close(): Promise<void> }>();
  const close = () => { jobs.forEach(job => { job.cancel(); void job.close(); }); jobs.clear(); };
  scope.signal.addEventListener("abort", close, { once: true });
  return {
    close,
    async start(entry: FileEntry, destination: string, conflict: "error" | "rename") {
      scope.assert("files.write");
      if (jobs.size >= 16) throw new Error("Close a finished transfer before starting another.");
      if (entry.kind === "file") {
        const job = await files.copyFile(entry, destination, entry.name, conflict);
        try { scope.assert("files.write"); }
        catch (error) { await job.close(); throw error; }
        jobs.set(job.jobId, { cancel: () => { void native("files.transferCancel", { jobId: job.jobId }).catch(() => undefined); }, close: job.close });
        return { jobId: job.jobId };
      }
      if (entry.kind !== "folder") throw new Error("Choose a file or folder to copy.");
      const id = `peer-transfer-${crypto.randomUUID()}`;
      const abort = new AbortController();
      const status: MistyFileTransferStatus = { status: "running", bytes: 0, files: 0, message: "Copying device folder…", result: null };
      const job = { status, cancel: () => abort.abort(), close: async () => { abort.abort(); } };
      jobs.set(id, job);
      void files.copyTree(entry.path, destination, entry.name, conflict, abort.signal,
        (bytes, count) => { status.bytes = bytes; status.files = count; },
      ).then(result => {
        status.status = "completed";
        status.message = "Transfer complete.";
        status.bytes = result.bytes; status.files = result.files;
        status.result = result.result as MistyFileTransferStatus["result"];
      }, error => {
        status.status = abort.signal.aborted || scope.signal.aborted ? "cancelled" : "failed";
        status.message = String(error).slice(0, 2048);
      });
      return { jobId: id };
    },
    async call(method: string, params?: unknown): Promise<unknown> {
      const id = (params as { jobId?: string } | undefined)?.jobId;
      const job = id ? jobs.get(id) : undefined;
      if (!job) return native(method, params);
      scope.assert("files.write");
      if (method === "files.transferStatus") return job.status ? { ...job.status } : native(method, params);
      if (method === "files.transferCancel") { job.cancel(); return null; }
      if (method === "files.transferClose") { await job.close(); jobs.delete(id!); return null; }
      return native(method, params);
    },
  };
}
