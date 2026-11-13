import { aiSurfaceApi } from "./api";
import { failInvocation, patchArtifact } from "./storeRuntime";
import type { MistyUndoReceipt } from "./invocationTypes";

import type { StoreApi } from "zustand";
import type { AiSurfaceState } from "./store";
import { assertMistyAvailable } from "../../conversations/state/availability";

// Undo for applied artifacts, by receipt id; it lives only as long as this window.
const undoCallbacks = new Map<string, () => void | Promise<void>>();

/** Accepting, rejecting or refining a proposed artifact, and undoing the last one applied. */
export function artifactActions(
  set: StoreApi<AiSurfaceState>["setState"],
  get: () => AiSurfaceState,
): Pick<AiSurfaceState, "decideArtifact" | "undoLast"> {
  return {
    decideArtifact: async (accountId, paneId, adapter, artifact, decision) => {
      if (decision === "accept") {
        await assertMistyAvailable(
          accountId,
          artifact.target?.spaceId ||
            adapter.getContext().find((ref) => ref.spaceId)?.spaceId ||
            "",
        );
      }
      if (decision === "refine") {
        set((state) => ({ companion: { ...state.companion, approval: undefined } }));
        return;
      }
      patchArtifact(set, get, accountId, paneId, artifact.id, {
        state: decision === "accept" ? "applying" : "rejected",
      });
      if (decision === "reject") {
        await aiSurfaceApi.decideArtifact(artifact.id, "reject", artifact.idempotencyKey);
        set((state) => ({ companion: { ...state.companion, approval: undefined } }));
        return;
      }
      try {
        const response = await aiSurfaceApi.decideArtifact(
          artifact.id,
          "accept",
          artifact.idempotencyKey,
          artifact.kind === "task_set" ? artifact.operations : undefined,
        );
        if (response.applyMode === "client") {
          if (!adapter.applyArtifact || adapter.canApply?.(artifact) === false) {
            throw new Error("The source changed. Ask your agent to regenerate this change.");
          }
          const clearHighlight = adapter.highlightArtifactTarget?.(artifact);
          await adapter.applyArtifact(artifact);
          if (typeof clearHighlight === "function") window.setTimeout(clearHighlight, 1_500);
          await aiSurfaceApi.completeArtifact(artifact.id, "applied");
        }
        await adapter.onArtifactApplied?.(response.artifact ?? artifact, response.result);
        patchArtifact(set, get, accountId, paneId, artifact.id, { state: "applied" });
        let undo: MistyUndoReceipt | undefined;
        if (adapter.undoArtifact) {
          undo = {
            id: crypto.randomUUID(),
            artifactId: artifact.id,
            title: `Undo ${artifact.title.toLowerCase()}`,
            expiresAt: new Date(Date.now() + 30_000).toISOString(),
          };
          undoCallbacks.set(undo.id, () => adapter.undoArtifact!(artifact));
        }
        set((state) => ({ companion: { ...state.companion, approval: undefined, undo } }));
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "That change could not be applied.";
        patchArtifact(set, get, accountId, paneId, artifact.id, {
          state: message.includes("changed") ? "stale" : "failed",
          error: message,
        });
        void aiSurfaceApi.completeArtifact(artifact.id, "failed", message).catch(() => undefined);
        failInvocation(set, get, accountId, paneId, message);
        throw error;
      }
    },

    undoLast: async () => {
      const receipt = get().companion.undo;
      if (!receipt || Date.parse(receipt.expiresAt) < Date.now()) return;
      await undoCallbacks.get(receipt.id)?.();
      undoCallbacks.delete(receipt.id);
      set((state) => ({ companion: { ...state.companion, undo: undefined } }));
    },
  };
}
