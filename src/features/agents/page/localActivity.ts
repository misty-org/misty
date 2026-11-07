import { localChats } from "@/features/misty/localChats";
import type { MistyActivityEntry } from "@/features/misty/activity";
import { agentAccountId } from "../agentAccount";

const maxEntries = 100;

/** An agent's recent runs, read from the chats kept on this computer. */
export async function localRunActivity(agentId?: string): Promise<MistyActivityEntry[]> {
  const chats = await localChats.conversations(agentAccountId());
  const entries = chats
    .filter((chat) => !agentId || chat.agentId === agentId)
    .flatMap((chat) =>
      chat.messages.flatMap((message, index): MistyActivityEntry[] => {
        if (message.role !== "assistant" || !message.invocationId) return [];
        const asked = chat.messages[index - 1];
        return [
          {
            id: message.invocationId,
            agent_id: chat.agentId,
            kind: "invocation",
            state: message.state ?? "completed",
            conversation_id: chat.id,
            run_id: message.invocationId,
            parent_run_id: "",
            delegation_depth: 0,
            title: asked?.role === "user" ? asked.content : chat.title,
            result: message.content,
            updated_at: message.createdAt,
            events: [],
          },
        ];
      }),
    );
  return entries.sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, maxEntries);
}
