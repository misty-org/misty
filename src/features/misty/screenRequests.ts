import type { ScreenRequest } from "@/features/ai-surface/types";
import { globalMistyError } from "@/features/global-search/globalMistyActions";
import {
  patchConversationMessage,
  type GlobalSearchGet,
  type GlobalSearchSet,
} from "@/features/global-search/globalSearchStoreHelpers";

/** Where a screen opens: a separate agent window or a tab in this window. */
export type ScreenChoice = "separate" | "window";

function findRequest(get: GlobalSearchGet, conversationId: string, messageId: string) {
  return get()
    .conversations.find((conversation) => conversation.id === conversationId)
    ?.messages.find((message) => message.id === messageId)?.screenRequest;
}

function patchRequest(
  set: GlobalSearchSet,
  get: GlobalSearchGet,
  conversationId: string,
  messageId: string,
  patch: Partial<ScreenRequest>,
) {
  const request = findRequest(get, conversationId, messageId);
  if (request)
    patchConversationMessage(set, get, conversationId, messageId, {
      screenRequest: { ...request, ...patch },
    });
}

/**
 * Runs once a response that asked for a screen finishes. Misty opens it where
 * the account setting says and continues; "ask each time" waits for the card.
 */
export function continueAfterScreenRequest(
  set: GlobalSearchSet,
  get: GlobalSearchGet,
  conversationId: string,
  messageId: string,
) {
  const request = findRequest(get, conversationId, messageId);
  if (request?.state !== "pending" || (request.kind === "open" && request.location === "ask"))
    return;
  void openScreenAndContinue(
    set,
    get,
    conversationId,
    messageId,
    request.location === "window" ? "window" : "separate",
  );
}

/** Opens the screen (or captures it) and continues the same conversation. */
export async function openScreenAndContinue(
  set: GlobalSearchSet,
  get: GlobalSearchGet,
  conversationId: string,
  messageId: string,
  choice: ScreenChoice,
) {
  const request = findRequest(get, conversationId, messageId);
  if (request?.state !== "pending") return;
  const patch = (next: Partial<ScreenRequest>) =>
    patchRequest(set, get, conversationId, messageId, next);
  patch({ state: "opening", error: undefined });
  try {
    if (get().working) throw new Error("Another task is running. Try again when it finishes.");
    const look = request.kind === "look";
    const desktop = request.kind === "desktop";
    if (
      desktop &&
      !(await import("@/features/agents/workspaceAutopilot")).visibleAutopilotAvailable()
    )
      throw new Error("Using other apps needs the Misty app on a Mac.");
    const { useCompanionState } = await import("@/features/agents/companion/companionState");
    const companion = useCompanionState.getState();
    if (look && companion.submit && companion.accountId === get().accountId) {
      // The companion captures every display, so its answer can point at them.
      // Close the panel first so the capture shows what the user was looking at.
      if (get().panel !== "closed") get().closePanel();
      await companion.submit({
        prompt: "Continue the request above. The user's screen is attached as an image.",
        conversationId,
        look: true,
        continuation: true,
      });
      const error = get().error;
      patch(error ? { state: "failed", error } : { state: "opened" });
      return;
    }
    const capture = look
      ? (await (await import("./screenContext")).captureMistyScreen()).capture
      : undefined;
    const where = look
      ? "The user's screen is attached as an image."
      : desktop
        ? "Misty can now use the user's desktop apps with its own cursor."
        : choice === "window"
          ? "A browser tab in the user's Misty window is now attached."
          : "A browser in a separate Misty window is now attached.";
    const start = request.url && !look && !desktop ? ` Start at ${request.url}.` : "";
    await get().submitAnswer(
      `Continue the request above. ${where}${start}`,
      [],
      undefined,
      get().panel === "closed" ? "workspace" : "panel",
      [],
      { conversationId, context: [] },
      {
        // Agent mode without a browser screen starts desktop control.
        executionMode: look ? "user" : desktop || choice === "window" ? "agent" : "team",
        continuation: true,
        capture,
        openScreen: !look && !desktop && choice === "window" ? { url: request.url } : undefined,
      },
    );
    const error = get().error;
    patch(error ? { state: "failed", error } : { state: "opened" });
  } catch (error) {
    patch({ state: "failed", error: globalMistyError(error) });
  }
}

export function declineScreenRequest(
  set: GlobalSearchSet,
  get: GlobalSearchGet,
  conversationId: string,
  messageId: string,
) {
  if (findRequest(get, conversationId, messageId)?.state === "pending")
    patchRequest(set, get, conversationId, messageId, { state: "declined" });
}
