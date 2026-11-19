import type { AiProgressItem } from "../../../runs/invocations/invocationEventTypes";
import type {
  GlobalAiMessage,
  MessageUsage,
  MistyImageAttachment,
} from "../../state/conversationTypes";
import { useMistyStore } from "../../state/useMistyStore";
import { parseUsage } from "../meta/usage";
import { readChatSession, readEngineSession, type EngineHistoryMessage } from "./engineHistory";

/** How much of a long session a chat shows: its latest messages, from a prompt on. */
const MAX_MESSAGES = 400;
/** A tool's arguments or result past this many characters are cut, so the saved chat stays small. */
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

/** A prompt's picture from the engine's session, drawn from its data URL. */
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

/**
 * An engine session's rows as the chat's own messages: each prompt with its pictures, then one
 * reply holding the engine's reasoning, the tool calls as steps, what the engine wrote between
 * them as notes, and its last words as the answer, each marked with the session
 * (`importedFrom`). A turn whose prompt Misty sent itself (`sentByMisty`) is left out with its
 * reply: the chat shows it already.
 */
export function sessionMessages(
  engine: string,
  sessionId: string,
  rows: readonly EngineHistoryMessage[],
  sentByMisty: (text: string) => boolean = () => false,
): GlobalAiMessage[] {
  const tag = `${engine}:${sessionId}`;
  const messages: GlobalAiMessage[] = [];
  let reply: GlobalAiMessage | undefined;
  // A turn the chat already shows is skipped up to the next prompt.
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
      // What it wrote before this step was a note on the way, not the answer.
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

/**
 * Whether a prompt in the session is one Misty sent: the session holds what the person typed,
 * sometimes with what Misty added after it (a browser hint, attached files), so it starts with
 * the chat's own prompt.
 */
function mistySent(prompts: readonly string[]) {
  return (text: string) => prompts.some((prompt) => text === prompt || text.startsWith(prompt));
}

/** A chat's messages in runs that stay together: a prompt with the replies after it. */
function turnsOf(messages: readonly GlobalAiMessage[]) {
  const turns: GlobalAiMessage[][] = [];
  for (const message of messages) {
    if (message.role === "user" || !turns.length) turns.push([message]);
    else turns[turns.length - 1].push(message);
  }
  return turns;
}

const timeOf = (turn: GlobalAiMessage[]) => Date.parse(turn[0]?.createdAt ?? "") || 0;

/**
 * Sync: pulls into the chat what happened in its engine session outside Misty (turns typed into
 * the engine's own app, or an earlier chat being resumed), read once from the CLI's own files.
 * Turns Misty sent itself are left out, what an earlier sync brought in is replaced, and the
 * session's turns go in among the chat's own by when they happened.
 */
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
      // Stable by time: the chat's own turns keep their order among themselves.
      const merged = [...turnsOf(own), ...turnsOf(pulled)]
        .map((turn, index) => ({ turn, index }))
        .sort((a, b) => timeOf(a.turn) - timeOf(b.turn) || a.index - b.index)
        .flatMap(({ turn }) => turn);
      return { ...conversation, messages: merged, updatedAt: new Date().toISOString() };
    }),
  }));
}

/** Sync for a chat as it is: its own engine session, if it has started one. */
export async function syncChat(conversationId: string) {
  const session = await readChatSession(conversationId);
  if (!session) throw new Error("This chat hasn’t started a session with its engine yet.");
  await syncEngineSession(conversationId, session);
}
