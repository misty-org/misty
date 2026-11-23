import { useMistyStore } from "../conversations/state/use_misty_store";
import { loadRunEntry } from "./run_contexts";

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
