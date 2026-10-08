import type { AppRequest } from "@/features/agents";
import { continuationScreen } from "@/features/agents/executionHandoff";
import { globalMistyError } from "@/features/global-search/globalMistyActions";
import {
  patchConversationMessage,
  type GlobalSearchGet,
  type GlobalSearchSet,
} from "@/features/global-search/globalSearchStoreHelpers";

// Each answered card continues its conversation at most once.
const continued = new Set<string>();

function continuationPrompt(request: AppRequest) {
  if (request.kind === "connect")
    return `Continue the request above. ${request.title.replace(/^Connect\s+/, "")} is now connected.`;
  return `Continue the request above. The user approved “${request.title}”.`;
}

/**
 * Runs when the user answers an app card. While the run that showed it is
 * still waiting, that run picks the answer up itself. After it handed off,
 * Misty continues the same conversation, as it does after opening a screen.
 */
export async function continueAfterAppRequest(
  set: GlobalSearchSet,
  get: GlobalSearchGet,
  conversationId: string,
  messageId: string,
  request: AppRequest,
) {
  patchConversationMessage(set, get, conversationId, messageId, { appRequest: request });
  if (request.state !== "connected" && request.state !== "approved") return;
  const conversation = get().conversations.find((item) => item.id === conversationId);
  // Only the latest answer continues; a newer turn means the user moved on.
  if (get().working || conversation?.messages[conversation.messages.length - 1]?.id !== messageId)
    return;
  if (continued.has(request.id)) return;
  continued.add(request.id);
  try {
    await get().submitAnswer(
      continuationPrompt(request),
      [],
      undefined,
      get().panel === "closed" ? "workspace" : "panel",
      [],
      { conversationId, context: [] },
      // On the screen the run that showed the card held, when it had one.
      { executionMode: "user", ...continuationScreen(conversationId), continuation: true },
    );
  } catch (error) {
    continued.delete(request.id);
    set({ error: globalMistyError(error) });
  }
}
