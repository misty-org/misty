import type { AiProgressItem } from "../../../runs/invocations/invocation_event_types";
import type {
  GlobalAiMessage,
  MessageUsage,
  MistyImageAttachment,
} from "../../state/conversation_types";
import { useMistyStore } from "../../state/use_misty_store";
import { parseUsage } from "../meta/usage";
import { readChatSession, readEngineSession, type EngineHistoryMessage } from "./engine_history";

const MAX_MESSAGES = 400;
const MAX_PAYLOAD = 4000;

function clip(value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (!text || text.length <= MAX_PAYLOAD) return value;
  return `${text.slice(0, MAX_PAYLOAD)}…`;
}

function usageOf(raw: unknown): MessageUsage | undefined {
  const parsed = parseUsage(raw);
  if (!parsed) return undefined;
  return {
    input: parsed.input,
    output: parsed.output,
    cacheRead: parsed.cacheRead,
    cacheWrite: parsed.cacheWrite,
    used: parsed.total,
    window: parsed.contextWindow,
  };
}

function pictureOf(url: string, id: string, index: number): MistyImageAttachment {
  const mime = /^data:([^;,]+)/.exec(url)?.[1] ?? "image/png";
  return {
    id: `${id}:image:${index}`,
    name: `Image ${index + 1}`,
    mimeType: mime as MistyImageAttachment["mimeType"],
    byteSize: 0,
    width: 0,
    height: 0,
    previewUrl: url,
    state: "ready",
  };
}

export function sessionMessages(
  engine: string,
  sessionId: string,
  rows: readonly EngineHistoryMessage[],
  sentByMisty: (text: string) => boolean = () => false,
): GlobalAiMessage[] {
  const tag = `${engine}:${sessionId}`;
  const messages: GlobalAiMessage[] = [];
  let reply: GlobalAiMessage | undefined;
  let skipping = false;
  let time = new Date(0).toISOString();
  for (const row of rows) {
    const stamp = row.ts ? Date.parse(row.ts) : Number.NaN;
    if (Number.isFinite(stamp)) time = new Date(stamp).toISOString();
    const id = `history:${tag}:${row.seq}`;
    if (row.role === "user") {
      reply = undefined;
      const text = row.text.trim();
      const pictures = row.images ?? [];
      skipping = (!text && !pictures.length) || (Boolean(text) && sentByMisty(text));
      if (!skipping)
        messages.push({
          id,
          role: "user",
          mode: "ask",
          content: row.text,
          createdAt: time,
          state: "completed",
          importedFrom: tag,
          ...(pictures.length
            ? { attachments: pictures.map((url, index) => pictureOf(url, id, index)) }
            : {}),
        });
      continue;
    }
    const kind = row.role;
    if (skipping || (kind !== "assistant" && kind !== "tool" && kind !== "thinking")) continue;
    if (!reply) {
      reply = {
        id,
        role: "assistant",
        mode: "ask",
        content: "",
        createdAt: time,
        state: "completed",
        progress: [],
        importedFrom: tag,
      };
      messages.push(reply);
    }
    const progress = reply.progress as AiProgressItem[];
    if (kind === "thinking") {
      const thought = row.text.trim();
      if (thought) reply.reasoning = reply.reasoning ? `${reply.reasoning}\n\n${thought}` : thought;
      continue;
    }
    if (row.role === "tool") {
      if (reply.content.trim()) progress.push({ type: "note", text: reply.content.trim() });
      reply.content = "";
      progress.push({
        type: "tool",
        id,
        name: row.text || "tool",
        state: "completed",
        args: clip(row.args),
        result: clip(row.result),
        path: row.path || undefined,
        durationMs: row.durationMs ?? undefined,
      });
      continue;
    }
    reply.content = reply.content ? `${reply.content}\n\n${row.text}` : row.text;
    if (row.model) reply.model = row.model;
    if (row.durationMs) reply.durationMs = Math.max(reply.durationMs ?? 0, row.durationMs);
    reply.usage = usageOf(row.usage) ?? reply.usage;
  }
  for (const message of messages) if (!message.progress?.length) delete message.progress;
  if (messages.length <= MAX_MESSAGES) return messages;
  const tail = messages.slice(-MAX_MESSAGES);
  const start = tail.findIndex((message) => message.role === "user");
  return start < 0 ? tail : tail.slice(start);
}

function mistySent(prompts: readonly string[]) {
  return (text: string) => prompts.some((prompt) => text === prompt || text.startsWith(prompt));
}

function turnsOf(messages: readonly GlobalAiMessage[]) {
  const turns: GlobalAiMessage[][] = [];
  for (const message of messages) {
    if (message.role === "user" || !turns.length) turns.push([message]);
    else turns[turns.length - 1].push(message);
  }
  return turns;
}

const timeOf = (turn: GlobalAiMessage[]) => Date.parse(turn[0]?.createdAt ?? "") || 0;

export async function syncEngineSession(
  conversationId: string,
  session: { engine: string; sessionId: string },
) {
  const rows = await readEngineSession(session.engine, session.sessionId);
  const from = `${session.engine}:${session.sessionId}`;
  useMistyStore.setState((state) => ({
    conversations: state.conversations.map((conversation) => {
      if (conversation.id !== conversationId) return conversation;
      const own = conversation.messages.filter((message) => message.importedFrom !== from);
      const prompts = own
        .filter((message) => message.role === "user" && !message.importedFrom)
        .map((message) => message.content.trim())
        .filter(Boolean);
      const pulled = sessionMessages(session.engine, session.sessionId, rows, mistySent(prompts));
      const merged = [...turnsOf(own), ...turnsOf(pulled)]
        .map((turn, index) => ({ turn, index }))
        .sort((a, b) => timeOf(a.turn) - timeOf(b.turn) || a.index - b.index)
        .flatMap(({ turn }) => turn);
      return { ...conversation, messages: merged, updatedAt: new Date().toISOString() };
    }),
  }));
}

export async function syncChat(conversationId: string) {
  const session = await readChatSession(conversationId);
  if (!session) throw new Error("This chat hasn’t started a session with its engine yet.");
  await syncEngineSession(conversationId, session);
}
