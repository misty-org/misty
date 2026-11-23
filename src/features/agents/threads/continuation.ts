import { newLocalConversation } from "../conversations/state/local_conversation";
import { useMistyStore } from "../conversations/state/use_misty_store";
import { openAgentThread } from "../tutor/cursor/tutor_handoff";
import { sharedThreadsApi, type SharedThread } from "./shared_threads";

interface Continuation {
  spaceId: string;
  threadId: string;
  ownerName: string;
  title: string;
}

const KEY = "misty:thread-continuations";
const MOST_CONTEXT = 12000;

function read(): Record<string, Continuation> {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Record<string, Continuation>) : {};
  } catch {
    return {};
  }
}

function write(all: Record<string, Continuation>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    return;
  }
}

export function continuationOf(conversationId: string): Continuation | undefined {
  return read()[conversationId];
}

export function continueThread(spaceId: string, thread: SharedThread): string {
  const chat = newLocalConversation(thread.title || "Thread", spaceId, thread.agent_id);
  useMistyStore.setState((state) => ({
    conversations: [chat, ...state.conversations.filter((item) => item.id !== chat.id)],
  }));
  write({
    ...read(),
    [chat.id]: {
      spaceId,
      threadId: thread.id,
      ownerName: thread.owner_name,
      title: thread.title,
    },
  });
  openAgentThread(thread.agent_id, chat.id);
  return chat.id;
}

export async function continuationNote(conversationId: string): Promise<string> {
  const continued = continuationOf(conversationId);
  if (!continued) return "";
  const chat = useMistyStore.getState().conversations.find((item) => item.id === conversationId);
  if (chat?.messages.some((message) => message.role === "assistant")) return "";
  const entries = await sharedThreadsApi
    .entries(continued.spaceId, continued.threadId)
    .catch(() => []);
  const lines: string[] = [];
  for (const entry of entries) {
    if (entry.kind === "ask") lines.push(`${continued.ownerName || "They"} asked: ${entry.body}`);
    else if (entry.kind === "reply") lines.push(`You answered: ${entry.body}`);
    else if (entry.kind === "output") lines.push(`Files it made in the Space:\n${entry.body}`);
  }
  let context = lines.join("\n\n");
  if (context.length > MOST_CONTEXT) context = context.slice(context.length - MOST_CONTEXT);
  const whose = continued.ownerName ? `${continued.ownerName}'s` : "another member's";
  return (
    `# Where this thread starts\nThis thread continues ${whose} thread "${continued.title}" with ` +
    `you. What happened there:\n\n${context}`
  );
}
