import { useMistyStore } from "../conversations/state/useMistyStore";
import { loadRunEntry } from "./runContexts";

/** What a connected app tool needs to know about its run, which a local call doesn't carry. */

/**
 * What the person asked for in this run, which decides whether a paid search app may be offered. Empty
 * when the chat is open in another window, and then an agent can't offer one.
 */
export async function appRunRequest(runId: string): Promise<string> {
  const entry = await loadRunEntry(runId);
  const messages =
    useMistyStore.getState().conversations.find((chat) => chat.id === entry?.conversationId)
      ?.messages ?? [];
  const reply = messages.findIndex((item) => item.invocationId === runId);
  const before = reply < 0 ? messages : messages.slice(0, reply);
  for (let index = before.length - 1; index >= 0; index--) {
    const message = before[index]!;
    if (message.role === "user" && message.source !== "continuation") return message.content;
  }
  return "";
}
