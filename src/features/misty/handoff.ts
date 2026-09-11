import { hasTauriInternals } from "@/shared/platform/tauri";
import { useMistyStore } from "./useMistyStore";
import { currentMistySpace } from "./availability";
import type {
  AiCaptureAttachment,
  AiArtifactKind,
  AiInvocationDeviceContext,
  AiSelectionSnapshot,
  AiSurfaceId,
} from "@/features/ai-surface/types";
import type { GlobalAiContextRef } from "@/features/global-search/types";

export interface MistyHandoff {
  capture?: AiCaptureAttachment;
  requestId?: string;
  notice?: string;
  prompt?: string;
  spaceId?: string;
  accountId?: string;
  context?: GlobalAiContextRef[];
  selection?: AiSelectionSnapshot;
  deviceContexts?: AiInvocationDeviceContext[];
  paneId?: string;
  surfaceId?: AiSurfaceId;
  requestedArtifactKind?: AiArtifactKind;
  conversationId?: string;
}
export async function acceptMistyHandoff(input: MistyHandoff) {
  const state = useMistyStore.getState();
  if (input.accountId && state.accountId !== input.accountId)
    throw new Error("The Misty account changed.");
  if (state.working)
    throw new Error("Wait for Misty's current response before changing its context.");
  const spaceId =
    input.spaceId || input.context?.find((ref) => ref.spaceId)?.spaceId || currentMistySpace();
  const current = state.conversations.find((c) => c.id === state.activeConversationId);
  if (input.conversationId) {
    await state.loadConversations();
    const conversation = useMistyStore
      .getState()
      .conversations.find((c) => c.id === input.conversationId);
    if (!conversation || conversation.spaceId !== spaceId)
      throw new Error("This conversation is unavailable in the selected Space.");
    state.selectConversation(input.conversationId);
  } else if (current && current.spaceId !== spaceId) await state.newConversation(spaceId);
  if (useMistyStore.getState().accountId !== state.accountId)
    throw new Error("The Misty account changed.");
  useMistyStore.setState({
    mode: "ask",
    selectedSpaceId: spaceId,
    query: input.prompt ?? state.query,
    context: input.context ?? state.context,
    handoff: input,
  });
  useMistyStore.getState().openPanel();
}
export async function openMisty(input: MistyHandoff = {}) {
  if (hasTauriInternals()) {
    const { getCurrentWindow, Window } =
      await import("@tauri-apps/api/window");
    if (getCurrentWindow().label !== "misty-bot-pet") {
      const companion = await Window.getByLabel("misty-bot-pet");
      if (!companion)
        throw new Error("Misty's desktop window is unavailable. Restart Misty to restore it.");
      const { useAppsStore } = await import("@/features/apps/useAppsStore");
      const requestId = crypto.randomUUID();
      const current = getCurrentWindow();
      await new Promise<void>((resolve, reject) => {
        let cleanup: (() => void) | undefined;
        const timer = window.setTimeout(() => {
          cleanup?.();
          reject(new Error("Misty did not receive this context. Try opening Misty again."));
        }, 5000);
        void current
          .listen<{ requestId: string; error?: string }>(
            "misty://handoff-result",
            ({ payload }) => {
              if (payload.requestId !== requestId) return;
              clearTimeout(timer);
              cleanup?.();
              if (payload.error) reject(new Error(payload.error));
              else resolve();
            },
          )
          .then((remove) => {
            cleanup = remove;
            return companion.emit("misty://handoff", {
              ...input,
              requestId,
              accountId: useAppsStore.getState().accountId,
              spaceId: input.spaceId || currentMistySpace(),
            });
          })
          .catch((error) => {
            clearTimeout(timer);
            cleanup?.();
            reject(error);
          });
      });
      await companion.show();
      return;
    }
  }
  await acceptMistyHandoff(input);
}
