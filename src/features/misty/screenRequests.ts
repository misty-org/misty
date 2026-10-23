import type { ScreenRequest } from "@/features/ai-surface/types";
import { globalMistyError } from "./globalMistyActions";
import { patchConversationMessage, type MistyGet, type MistySet } from "./mistyStoreHelpers";

/** Where a screen opens: the user's tab or a new tab in this window. */
export type ScreenChoice = "current" | "window";

/** The choice a request's location stands for; "ask" waits for the card. */
export function screenChoice(location: ScreenRequest["location"]): ScreenChoice {
  return location === "current" ? "current" : "window";
}

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
 * the account setting says and continues; "ask each time" waits for the card,
 * unless an open tab already matches what the agent needs.
 */
export async function continueAfterScreenRequest(
  set: MistySet,
  get: MistyGet,
  conversationId: string,
  messageId: string,
) {
  const request = findRequest(get, conversationId, messageId);
  if (request?.state !== "pending") return;
  if (request.kind === "open" && request.location === "ask") {
    // Without the matcher, the card still lets the person choose.
    const tabs = await import("@/features/agents/companion/normalTabs").catch(() => null);
    if (
      !tabs ||
      request.chosen ||
      !tabs.matchingBrowserTab(`${request.reason} ${request.url ?? ""}`)
    )
      return;
  }
  void openScreenAndContinue(set, get, conversationId, messageId, screenChoice(request.location));
}

/** Opens the screen (or captures it) and continues the same conversation. */
export async function openScreenAndContinue(
  set: MistySet,
  get: MistyGet,
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
      throw new Error("Using other apps needs the Misty app on macOS or Windows.");
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
    // Unless the user named a place, a site they already have open ("my Gmail
    // tab") is worked on where it is rather than opened again.
    const reused =
      !look && !desktop && !request.chosen
        ? (await import("@/features/agents/companion/normalTabs")).matchingBrowserTab(
            `${request.reason} ${request.url ?? ""}`,
          )
        : undefined;
    const where = look
      ? "The user's screen is attached as an image."
      : desktop
        ? "Misty can now use the user's desktop apps with its own cursor."
        : reused
          ? `The user's open tab "${reused.title.slice(0, 120)}" is now attached. Work in it; do not open another.`
          : choice === "current"
            ? "The user's current Misty tab is now attached."
            : "A new browser tab in the user's Misty window is now attached.";
    const start = request.url && !look && !desktop && !reused ? ` Start at ${request.url}.` : "";
    await get().submitAnswer(
      `Continue the request above. ${where}${start}`,
      [],
      undefined,
      get().panel === "closed" ? "workspace" : "panel",
      [],
      { conversationId, context: [] },
      {
        // Agent mode without a browser screen starts desktop control.
        executionMode: look ? "user" : "agent",
        continuation: true,
        capture,
        openScreen: reused
          ? { url: request.url, hint: request.reason, tabId: reused.id, place: "current" }
          : !look && !desktop
            ? {
                url: request.url,
                hint: request.reason,
                place: choice === "current" ? "current" : "new",
              }
            : undefined,
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
