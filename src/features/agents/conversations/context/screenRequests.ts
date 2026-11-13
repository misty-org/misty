import type { ScreenRequest } from "../../runs/invocations/invocationTypes";
import { globalMistyError } from "../state/globalMistyActions";
import { patchConversationMessage, type MistyGet, type MistySet } from "../state/mistyStoreUpdates";
import { useCompanionState } from "../../tutor/cursor/companionState";

function findRequest(get: MistyGet, conversationId: string, messageId: string) {
  return get()
    .conversations.find((conversation) => conversation.id === conversationId)
    ?.messages.find((message) => message.id === messageId)?.screenRequest;
}

function patchRequest(
  set: MistySet,
  get: MistyGet,
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
export async function continueAfterScreenRequest(
  set: MistySet,
  get: MistyGet,
  conversationId: string,
  messageId: string,
) {
  const request = findRequest(get, conversationId, messageId);
  if (request?.state !== "pending") return;
  if (request.kind === "open" && request.location === "ask") return;
  void openScreenAndContinue(set, get, conversationId, messageId);
}

/** Opens the screen in a new tab of this window (or captures it) and continues the same
 * conversation. */
export async function openScreenAndContinue(
  set: MistySet,
  get: MistyGet,
  conversationId: string,
  messageId: string,
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
      !(await import("@/features/agents/runs/jobs/workspaceAutopilot")).visibleAutopilotAvailable()
    )
      throw new Error("Using other apps needs the Misty app on macOS or Windows.");
    const companion = useCompanionState.getState();
    if (look && companion.submit && companion.accountId === get().accountId) {
      // The companion captures every display, so its answer can point at them.
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
        : "A new browser tab in the user's Misty window is now attached.";
    const start = request.url && !look && !desktop ? ` Start at ${request.url}.` : "";
    await get().submitAnswer(
      `Continue the request above. ${where}${start}`,
      [],
      undefined,
      [],
      { conversationId, context: [] },
      {
        // Agent mode without a browser screen starts desktop control.
        executionMode: look ? "user" : "agent",
        continuation: true,
        capture,
        openScreen: !look && !desktop,
      },
    );
    const error = get().error;
    patch(error ? { state: "failed", error } : { state: "opened" });
  } catch (error) {
    patch({ state: "failed", error: globalMistyError(error) });
  }
}

export function declineScreenRequest(
  set: MistySet,
  get: MistyGet,
  conversationId: string,
  messageId: string,
) {
  if (findRequest(get, conversationId, messageId)?.state === "pending")
    patchRequest(set, get, conversationId, messageId, { state: "declined" });
}
