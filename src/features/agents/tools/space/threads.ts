import type { LocalToolHandler } from "../host";
import {
  BAD_SCHEMA,
  readRoute,
  refuse,
  rewordRefusal,
  segment,
  spacePath,
  writeRoute,
} from "./api";
import { integer, onlyFields, text, textList, truncate } from "./args";
import { routedTool } from "./routing";

const READ_LIMIT = 30;
const MAX_MESSAGE_CHARS = 4000;
const NO_THREAD = "no thread with that id that you can use in this Space; call thread_list";

interface Thread {
  id: string;
  title: string;
  kind: string;
  participants?: unknown[];
  updated_at: string;
}

interface ThreadMessage {
  id: string;
  sender_name: string;
  sender_kind: string;
  content: { text?: string; label?: string }[];
  created_at: string;
}

/** Whole seconds in UTC, as these tools have always written times. */
export function wholeSeconds(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString().replace(/\.\d+Z$/, "Z");
}

const spansText = (spans: ThreadMessage["content"]) =>
  spans
    .map((span) => span.text || span.label || "")
    .join("")
    .trim();

const threadMessages = (spaceId: string, threadId: string) =>
  spacePath(spaceId, `/conversations/${segment(threadId)}/messages`);

const create = routedTool("create", async (request, space) => {
  onlyFields(request.input, ["title", "member_ids", "space"]);
  const title = text(request.input, "title", { required: true, min: 1, max: 120 });
  const memberIds = textList(request.input, "member_ids", {
    required: true,
    min: 1,
    max: 50,
    itemMin: 1,
    itemMax: 200,
  }) as string[];
  const participants = memberIds.map((id) => ({ kind: "person", user_id: id.trim() }));
  const thread = await rewordRefusal(
    () =>
      writeRoute<Thread>(request, spacePath(space.id, "/conversations"), "POST", {
        title,
        participants,
      }),
    (refused) =>
      refused.status === 400 || refused.status === 404
        ? "a thread needs a title and members of this Space; resolve them with space_member_resolve"
        : undefined,
  );
  return { thread: { id: thread.id, title: thread.title } };
});

const list = routedTool("read", async (request, space) => {
  onlyFields(request.input, ["space"]);
  const { conversations } = await readRoute<{ conversations: Thread[] }>(
    request,
    spacePath(space.id, "/conversations"),
  );
  return {
    threads: conversations.map((thread) => ({
      id: thread.id,
      title: thread.title,
      kind: thread.kind,
      participants: thread.participants?.length ?? 0,
      updated_at: wholeSeconds(thread.updated_at),
    })),
  };
});

const read = routedTool("read", async (request, space) => {
  onlyFields(request.input, ["thread_id", "limit", "space"]);
  const threadId = text(request.input, "thread_id", { required: true, min: 1, max: 200 }).trim();
  const limit = integer(request.input, "limit", 1, READ_LIMIT) ?? 20;
  const { messages } = await rewordRefusal(
    () =>
      readRoute<{ messages: ThreadMessage[] }>(
        request,
        `${threadMessages(space.id, threadId)}?limit=${limit}`,
      ),
    (refused) => ([400, 403, 404].includes(refused.status) ? NO_THREAD : undefined),
  );
  return {
    messages: messages.map((message) => ({
      author: message.sender_name,
      author_kind: message.sender_kind,
      text: truncate(spansText(message.content), 2000),
      at: wholeSeconds(message.created_at),
    })),
  };
});

const post = routedTool("change", async (request, space) => {
  onlyFields(request.input, ["thread_id", "message", "space"]);
  const threadId = text(request.input, "thread_id", { required: true, min: 1, max: 200 });
  const message = text(request.input, "message", {
    required: true,
    min: 1,
    max: MAX_MESSAGE_CHARS,
  });
  if (!message.trim()) throw refuse(BAD_SCHEMA);
  const sent = await rewordRefusal(
    () =>
      writeRoute<{ message: ThreadMessage }>(
        request,
        threadMessages(space.id, threadId.trim()),
        "POST",
        { content: [{ type: "text", text: message }] },
      ),
    (refused) => ([400, 403, 404].includes(refused.status) ? NO_THREAD : undefined),
  );
  return { posted: sent.message.id, thread_id: threadId };
});

export const threadTools: Record<string, LocalToolHandler> = {
  "thread.create": create,
  "thread.list": list,
  "thread.read": read,
  "thread.post": post,
};
