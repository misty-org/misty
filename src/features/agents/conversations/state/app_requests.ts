import type { AppRequest } from "../../connected-apps/api";
import { continuationScreen } from "../../runs/jobs/execution_handoff";
import { globalMistyError } from "./global_misty_actions";
import { patchConversationMessage, type MistyGet, type MistySet } from "./misty_store_updates";

const continued = new Set<string>();

function continuationPrompt(request: AppRequest) {
  if (request.kind === "connect")
    return `Continue the request above. ${request.title.replace(/^Connect\s+/, "")} is now connected.`;
  return `Continue the request above. The user approved “${request.title}”.`;
}

export async function continueAfterAppRequest(
  set: MistySet,
  get: MistyGet,
  conversationId: string,
  messageId: string,
  request: AppRequest,
) {
  patchConversationMessage(set, get, conversationId, messageId, { appRequest: request });
  if (request.state !== "connected" && request.state !== "approved") return;
  const conversation = get().conversations.find((item) => item.id === conversationId);
  if (get().working || conversation?.messages[conversation.messages.length - 1]?.id !== messageId)
    return;
  if (continued.has(request.id)) return;
  continued.add(request.id);
  try {
    await get().submitAnswer(
      continuationPrompt(request),
      [],
      undefined,
      [],
      { conversationId, context: [] },
      { executionMode: "user", ...continuationScreen(conversationId), continuation: true },
    );
  } catch (error) {
    continued.delete(request.id);
    set({ error: globalMistyError(error) });
  }
}
