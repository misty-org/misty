import type { LocalToolHandler } from "../host";
import { readRoute, refuse, segment, spacePath, writeRoute } from "./api";
import { integer, text } from "./args";
import { containsPhrase, spaceMembers, type Member } from "./members";
import { routedTool } from "./routing";

const MAX_MESSAGE_CHARS = 4000;

interface MessageSpan {
  type: string;
  text?: string;
  user_id?: string;
  label?: string;
}

interface SpaceMessage {
  id: string;
}

const search = routedTool("read", async (request, space) => {
  const query = text(request.input, "query").trim();
  const limit = integer(request.input, "limit");
  const count = limit === undefined || limit < 1 || limit > 50 ? 20 : limit;
  const path = query
    ? spacePath(space.id, `/messages/search?q=${segment(query)}&limit=${count}`)
    : spacePath(space.id, "/messages?limit=100");
  const { messages } = await readRoute<{ messages: SpaceMessage[] }>(request, path);
  const matches = messages.slice(0, count);
  return { messages: matches, count: matches.length };
});

function recipientFor(members: Member[], me: string, requested: string, message: string) {
  if (requested) {
    const member = members.find(({ user_id }) => user_id === requested && requested !== me);
    if (!member) throw refuse("recipientUserId must identify another member of this Space");
    return member;
  }
  const named = members.filter(
    (member) => member.user_id !== me && member.name && containsPhrase(message, member.name),
  );
  return named.length === 1 ? named[0] : undefined;
}

function audienceFor(requested: string, hasRecipient: boolean): "private" | "space" {
  const audience = requested.trim().toLowerCase();
  if (audience === "private" || audience === "space") return audience;
  if (audience !== "" && audience !== "auto")
    throw refuse("audience must be auto, private, or space");
  if (hasRecipient) return "private";
  throw refuse(
    "choose audience private (with recipientUserId) or space; ask the user if their intent is unclear",
  );
}

/** Text with each "@Name" of the recipient as a real mention of them. */
export function messageSpans(message: string, recipient?: Member): MessageSpan[] {
  const plain = [{ type: "text", text: message }];
  if (!recipient?.name.trim()) return plain;
  const needle = `@${recipient.name}`.toLowerCase();
  const lower = message.toLowerCase();
  const spans: MessageSpan[] = [];
  let from = 0;
  let emitted = 0;
  for (;;) {
    const index = lower.indexOf(needle, from);
    if (index < 0) break;
    const end = index + needle.length;
    if (end < message.length && /[A-Za-z0-9_]/.test(message[end])) {
      from = end;
      continue;
    }
    if (index > emitted) spans.push({ type: "text", text: message.slice(emitted, index) });
    spans.push({ type: "mention", user_id: recipient.user_id, label: recipient.name });
    from = end;
    emitted = end;
  }
  if (emitted === 0) return plain;
  if (emitted < message.length) spans.push({ type: "text", text: message.slice(emitted) });
  return spans;
}

const send = routedTool("change", async (request, space) => {
  const message = text(request.input, "message", { max: MAX_MESSAGE_CHARS }).trim();
  const requested = text(request.input, "recipientUserId").trim();
  const audienceAsked = text(request.input, "audience");
  if (!message) throw refuse("message is required");
  const [members, me] = await Promise.all([
    spaceMembers(request, space.id),
    readRoute<{ id: string }>(request, "/me"),
  ]);
  const recipient = recipientFor(members, me.id, requested, message);
  const audience = audienceFor(audienceAsked, recipient !== undefined);
  let conversationId = "";
  if (audience === "private") {
    if (!recipient) throw refuse("a private message requires one resolved recipient");
    // Opening a DM returns the same one every time, so a failure here changes nothing worth doubting.
    const direct = await readRoute<{ id: string }>(
      request,
      spacePath(space.id, "/conversations/dm"),
      "POST",
      { user_id: recipient.user_id },
    );
    conversationId = direct.id;
  }
  const path = conversationId
    ? spacePath(space.id, `/conversations/${segment(conversationId)}/messages`)
    : spacePath(space.id, "/messages");
  const sent = await writeRoute<{ message: SpaceMessage }>(request, path, "POST", {
    content: messageSpans(message, recipient),
  });
  return {
    message_id: sent.message.id,
    space_id: space.id,
    conversation_id: conversationId,
    audience,
  };
});

export const messageTools: Record<string, LocalToolHandler> = {
  "message.search": search,
  "message.send": send,
};
