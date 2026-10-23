import { analytics } from "@/telemetry/client";
import { aiSurfaceApi } from "./api";
import { aiSessionKey } from "./storeHelpers";
import { failInvocation, makeSpeech, patchArtifact, scheduleHome } from "./storeRuntime";
import type { MistyUndoReceipt } from "./types";

import type { StoreApi } from "zustand";
import type { AiSurfaceState } from "./store";

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
        const { assertMistyAvailable } = await import("@/features/misty/availability");
        await assertMistyAvailable(
          accountId,
          artifact.target?.spaceId ||
            adapter.getContext().find((ref) => ref.spaceId)?.spaceId ||
            "",
        );
      }
      analytics.track("ai_companion_artifact_decided", {
        surface: adapter.surfaceId,
        artifact_kind: artifact.kind,
        decision,
      });
      if (decision === "refine") {
        set((state) => ({
          companion: {
            ...state.companion,
            phase: "composing",
            approval: undefined,
            speech: makeSpeech(
              "clarification",
              `What should I change about ${artifact.title}?`,
              true,
            ),
          },
        }));
        return;
      }
      patchArtifact(set, get, accountId, paneId, artifact.id, {
        state: decision === "accept" ? "applying" : "rejected",
      });
      if (decision === "reject") {
        await aiSurfaceApi.decideArtifact(artifact.id, "reject", artifact.idempotencyKey);
        set((state) => ({
          companion: {
            ...state.companion,
            phase: "speaking",
            approval: undefined,
            speech: makeSpeech("reply", "Canceled."),
          },
        }));
        scheduleHome(get, accountId);
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
        analytics.track("ai_companion_direct_effect", {
          surface: adapter.surfaceId,
          artifact_kind: artifact.kind,
        });
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
        set((state) => ({
          companion: {
            ...state.companion,
            phase: state.companion.phase === "home" ? "home" : "speaking",
            approval: undefined,
            undo,
            speech: makeSpeech("reply", artifact.summary || "Done."),
            completedCount:
              state.companion.phase === "home"
                ? state.companion.completedCount + 1
                : state.companion.completedCount,
          },
        }));
        scheduleHome(get, accountId);
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
      const current = get().companion;
      const registration =
        current.accountId && current.paneId
          ? get().registrations[aiSessionKey(current.accountId, current.paneId)]
          : undefined;
      if (registration)
        analytics.track("ai_companion_undo", { surface: registration.adapter.surfaceId });
      undoCallbacks.delete(receipt.id);
      set((state) => ({
        companion: {
          ...state.companion,
          undo: undefined,
          speech: makeSpeech("reply", "Undone."),
          phase: "speaking",
        },
      }));
      scheduleHome(get, get().companion.accountId);
    },
  };
}
