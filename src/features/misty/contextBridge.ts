import { invoke } from "@tauri-apps/api/core";
import { hasTauriInternals } from "@/shared/platform/tauri";
import {
  contextOptions,
  resolveMistyContext,
  type MistyContextSnapshot,
  type MistyContextTarget,
} from "./context";
import { useUserStore } from "@/features/auth/core";
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
  if (request.accountId !== useUserStore.getState().me?.id)
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
  return current.onFocusChanged(({ payload }) => {
    if (payload) void invoke("misty_workspace_focused").catch(() => undefined);
  });
}
export async function requestHostContext<T = MistyContextSnapshot>(
  input: Omit<Request, "id">,
): Promise<T> {
  return (await handleContextRequest(input)) as T;
}
