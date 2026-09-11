import { invoke } from "@tauri-apps/api/core";
import { hasTauriInternals } from "@/shared/platform/tauri";
import {
  contextOptions,
  resolveMistyContext,
  type MistyContextSnapshot,
  type MistyContextTarget,
} from "./context";
import { useAppsStore } from "@/features/apps/useAppsStore";
import { useAiSurfaceStore } from "@/features/ai-surface/store";
import type { AiInvocationEvent } from "@/features/ai-surface/types";
import { consumeInvocationEvent } from "@/features/ai-surface/storeRuntime";

type Request = {
  id: string;
  accountId: string;
  spaceId: string;
  targets: MistyContextTarget[];
  options?: boolean;
  event?: AiInvocationEvent;
  paneId?: string;
  artifactId?: string;
  undoId?: string;
  decision?: "accept" | "reject" | "refine";
};
async function handleContextRequest(request: Omit<Request, "id">): Promise<unknown> {
  if (request.accountId !== useAppsStore.getState().accountId)
    throw new Error("The Misty account changed.");
  if (!request.event && !request.decision && !request.undoId)
    return request.options
      ? contextOptions(request.spaceId)
      : resolveMistyContext(request.accountId, request.spaceId, request.targets);
  const store = useAiSurfaceStore;
  const registration = store.getState().registrations[`${request.accountId}:${request.paneId}`];
  if (!registration) throw new Error("The source pane is no longer available.");
  if (
    registration.adapter.getContext().some((ref) => ref.spaceId && ref.spaceId !== request.spaceId)
  )
    throw new Error("The source pane moved to another Space.");
  if (request.event)
    consumeInvocationEvent(
      store.setState,
      store.getState,
      request.accountId,
      registration.paneId,
      registration.adapter,
      request.event,
    );
  if (request.decision) {
    const { assertMistyAvailable } = await import("./availability");
    await assertMistyAvailable(request.accountId, request.spaceId);
    const artifact = store.getState().companion.approval?.artifact;
    if (!artifact || artifact.id !== request.artifactId)
      throw new Error("This proposal is no longer available. Open its conversation again.");
    if (
      request.decision === "accept" &&
      (Date.parse(artifact.expiresAt) <= Date.now() ||
        registration.adapter.canApply?.(artifact) === false)
    )
      throw new Error("The source changed. Ask Misty to regenerate this proposal.");
    if (
      artifact.target &&
      !registration.adapter
        .getContext()
        .some((ref) => ref.id === artifact.target?.id && ref.kind === artifact.target?.kind)
    )
      throw new Error("This pane no longer contains the proposal's source.");
    await store
      .getState()
      .decideArtifact(
        request.accountId,
        registration.paneId,
        registration.adapter,
        artifact,
        request.decision,
      );
    return store.getState().companion.undo;
  }
  if (request.undoId) {
    if (store.getState().companion.undo?.id !== request.undoId)
      throw new Error("This undo is no longer available.");
    await store.getState().undoLast();
  }
}
export async function installMistyContextBridge() {
  if (!hasTauriInternals()) return () => {};
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const current = getCurrentWindow();
  if (current.label !== "main") return () => {};
  const broadcastSpace = () =>
    current.emitTo("misty-bot-pet", "misty://active-space", {
      accountId: useAppsStore.getState().accountId,
      spaceId: useAppsStore.getState().spaceId,
    });
  const removeSpace = useAppsStore.subscribe((state, previous) => {
    if (state.spaceId !== previous.spaceId) void broadcastSpace().catch(() => undefined);
  });
  let removeFocus = () => {};
  try {
  removeFocus = await current.onFocusChanged(({ payload }) => {
    if (payload) {
      void invoke("misty_workspace_focused").catch(() => undefined);
      void broadcastSpace().catch(() => undefined);
    }
  });
  const removeRequest = await current.listen<Request>(
    "misty://context-request",
    async ({ payload: request }) => {
      let value: unknown, error: string | undefined;
      try {
        value = await handleContextRequest(request);
      } catch (reason) {
        error = reason instanceof Error ? reason.message : "Context unavailable";
      }
      await current.emitTo("misty-bot-pet", "misty://context-result", {
        id: request.id,
        value,
        error,
      }).catch(() => undefined);
    },
  );
  return () => {
    removeSpace();
    removeFocus();
    removeRequest();
  };
  } catch (error) {
    removeSpace();
    removeFocus();
    throw error;
  }
}
export async function requestHostContext<T = MistyContextSnapshot>(
  input: Omit<Request, "id">,
): Promise<T> {
  if (!hasTauriInternals()) return (await handleContextRequest(input)) as T;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const current = getCurrentWindow();
  if (current.label === "main") return (await handleContextRequest(input)) as T;
  const id = crypto.randomUUID();
  return new Promise<T>((resolve, reject) => {
    let cleanup: (() => void) | undefined;
    const timer = window.setTimeout(() => {
      cleanup?.();
      reject(new Error("The workspace did not respond. Open the main Misty window and retry."));
    }, 5000);
    void current
      .listen<{ id: string; value: T; error?: string }>("misty://context-result", ({ payload }) => {
        if (payload.id !== id) return;
        clearTimeout(timer);
        cleanup?.();
        if (payload.error) reject(new Error(payload.error));
        else resolve(payload.value);
      })
      .then((remove) => {
        cleanup = remove;
        return current.emitTo("main", "misty://context-request", { ...input, id });
      })
      .catch((error) => {
        clearTimeout(timer);
        cleanup?.();
        reject(error);
      });
  });
}
