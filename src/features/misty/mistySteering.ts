import { apiRequest } from "@/api/client";
import {
  conversationMessage,
  updateConversation,
  type MistyGet,
  type MistySet,
} from "./mistyStoreHelpers";

let steeringRequest:
  | { accountId: string; invocationId: string; text: string; key: string; pending?: Promise<void> }
  | undefined;

/** Forgets a follow-up in flight, when the account changes. */
export function resetSteering() {
  steeringRequest = undefined;
}

/** Sends a follow-up to the running task; repeating the same text reuses its idempotency key. */
export async function steerResponse(
  set: MistySet,
  get: MistyGet,
  text: string,
  conversationId = get().activeConversationId,
) {
  const state = get();
  if (
    !text.trim() ||
    !state.working ||
    !state.invocationId ||
    conversationId !== (state.invocationConversationId ?? state.activeConversationId)
  )
    throw new Error("Open the active task conversation before sending a follow-up.");
  if (
    !steeringRequest ||
    steeringRequest.accountId !== state.accountId ||
    steeringRequest.invocationId !== state.invocationId ||
    steeringRequest.text !== text
  )
    steeringRequest = {
      accountId: state.accountId,
      invocationId: state.invocationId,
      text,
      key: crypto.randomUUID(),
    };
  const request = steeringRequest;
  if (request.pending) return request.pending;
  request.pending = (async () => {
    const receipt = await apiRequest<{ sequence: number }>(
      `/ai/invocations/${encodeURIComponent(request.invocationId)}/steering`,
      { method: "POST", body: JSON.stringify({ text, idempotencyKey: request.key }) },
    );
    if (get().accountId !== request.accountId) return;
    const id = `${request.invocationId}-steering-${receipt.sequence}`;
    updateConversation(set, get, conversationId, (conversation) => ({
      ...conversation,
      messages: conversation.messages.some((m) => m.id === id)
        ? conversation.messages
        : [
            ...conversation.messages,
            {
              ...conversationMessage("user", "ask", text),
              id,
              state: "completed",
              activity: "Queued for the next safe boundary",
            },
          ],
    }));
    if (get().query === text) set({ query: "", error: null });
    if (steeringRequest === request) steeringRequest = undefined;
  })().finally(() => {
    request.pending = undefined;
  });
  return request.pending;
}
