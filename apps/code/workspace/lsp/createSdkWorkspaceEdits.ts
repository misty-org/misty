import type { createSdkCodeRuntime } from "../sdkCodeRuntime";
import { createWorkspaceEdits } from "./createWorkspaceEdits";
export function createSdkWorkspaceEdits(
  runtime: ReturnType<typeof createSdkCodeRuntime>,
  options: {
    signal?: AbortSignal;
    documentVersion?(root: string, path: string): number | null;
  } = {},
) {
  return createWorkspaceEdits({
    ...options,
    signal: options.signal ?? runtime.signal,
    state: runtime.sharedState?.edits,
    assertWritable(root) {
      if (!runtime.project(root).writable)
        throw new Error("This edit includes a read-only project.");
    },
    maxFileBytes: 5 * 1024 * 1024,
    store: runtime.store,
    ensureBuffer: runtime.ensureFile,
    flushBuffer: runtime.flushBuffer,
  });
}
