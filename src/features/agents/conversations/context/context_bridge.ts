import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { hasTauriInternals } from "@/shared/platform/tauri";
import {
  contextOptions,
  resolveMistyContext,
  type MistyContextSnapshot,
  type MistyContextTarget,
} from "./context";
import { agentAccountId } from "../../personal/agent_account";
import { useAiSurfaceStore } from "../../runs/invocations/store";
import type { AiInvocationEvent } from "../../runs/invocations/invocation_types";
import { consumeInvocationEvent } from "../../runs/invocations/store_runtime";
import { isProfileWindowLabel } from "@/features/app-windows";
import { assertMistyAvailable } from "../state/availability";
import { useMistyStore } from "../state/use_misty_store";

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
  if (request.accountId !== agentAccountId()) throw new Error("The Misty account changed.");
  if (!request.event && !request.decision && !request.undoId)
    return request.options
      ? contextOptions(request.spaceId)
      : resolveMistyContext(request.accountId, request.spaceId, request.targets);
  const store = useAiSurfaceStore;
  const registration = store.getState().registrations[`${request.accountId}:${request.paneId}`];
  if (!registration) throw new Error("The source pane is no longer available.");
  if (
    request.spaceId &&
    registration.adapter.getContext().some((ref) => ref.spaceId && ref.spaceId !== request.spaceId)
  )
    throw new Error("The source pane moved to another Space.");
  if (request.event)
    consumeInvocationEvent(
      store.setState,
      store.getState,
      request.accountId,
      registration.paneId,
      request.event,
    );
  if (request.decision) {
    await assertMistyAvailable(request.accountId, request.spaceId);
    const artifact = [
      store.getState().companion.approval?.artifact,
      useMistyStore.getState().pendingArtifact,
    ].find((item) => item?.id === request.artifactId);
    if (!artifact || artifact.id !== request.artifactId)
      throw new Error("This proposal is no longer available. Open its conversation again.");
    if (
      request.decision === "accept" &&
      (Date.parse(artifact.expiresAt) <= Date.now() ||
        registration.adapter.canApply?.(artifact) === false)
    )
      throw new Error("The source changed. Ask your agent to regenerate this proposal.");
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
  const current = getCurrentWindow();
  if (!isProfileWindowLabel(current.label)) return () => {};
  return current.onFocusChanged(({ payload }) => {
    if (payload) void invoke("misty_workspace_focused").catch(() => undefined);
  });
}
export async function requestHostContext<T = MistyContextSnapshot>(
  input: Omit<Request, "id">,
): Promise<T> {
  return (await handleContextRequest(input)) as T;
}
