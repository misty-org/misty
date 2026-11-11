import type { SpaceMessage } from "../api/dto/entities";

/**
 * Handoffs and claims travel as ordinary Space chat messages a person sends. The server has no
 * field for a message's kind, so the first words mark it and the chat draws it as a card.
 */
export const handoffMark = "Handoff:";
export const claimMark = "Working on:";

/** A claim stops showing a day after it was posted, released or not. */
export const claimLifetimeMs = 24 * 60 * 60 * 1000;
export const claimMaxLength = 140;

type PostMessage = Pick<SpaceMessage, "sender_kind" | "content" | "origin">;

export type SpacePost = { kind: "handoff" | "claim"; text: string };

/** The message a handoff is sent as: the mark on its own line, then the person's words. */
export function handoffBody(text: string): string {
  return `${handoffMark}\n${text.trim()}`;
}

/** The message a claim is sent as, kept to one line. */
export function claimBody(text: string): string {
  return `${claimMark} ${text.replace(/\s+/g, " ").trim().slice(0, claimMaxLength)}`;
}

function plainText(content: SpaceMessage["content"]): string {
  return content
    .map((span) =>
      span.type === "text" ? span.text : span.type === "mention" ? `@${span.label}` : span.label,
    )
    .join("");
}

function afterMark(text: string, mark: string): string | undefined {
  const trimmed = text.trimStart();
  if (trimmed.slice(0, mark.length).toLowerCase() !== mark.toLowerCase()) return undefined;
  return trimmed.slice(mark.length).trim() || undefined;
}

/**
 * Reads a message as a handoff or a claim. Only a person's own message counts: one an agent or
 * the system wrote is never either, whatever it starts with.
 */
export function readSpacePost(message: PostMessage): SpacePost | undefined {
  if (message.sender_kind !== "person" || message.origin?.kind) return undefined;
  const text = plainText(message.content);
  const handoff = afterMark(text, handoffMark);
  if (handoff) return { kind: "handoff", text: handoff };
  const claim = afterMark(text, claimMark);
  return claim ? { kind: "claim", text: claim.replace(/\s+/g, " ") } : undefined;
}

export interface IncomingHandoff {
  id: string;
  /** Empty for the Space's main chat. */
  conversationId: string;
  fromUserId: string;
  fromName: string;
  text: string;
  createdAt: string;
}

/**
 * Whether a handoff is for this person: someone else sent it, in a direct message with them or
 * with a mention of them.
 */
export function handoffIsFor(message: SpaceMessage, me: string, direct: boolean): boolean {
  if (!me || message.sender_user_id === me || message.local_delivery_state) return false;
  if (readSpacePost(message)?.kind !== "handoff") return false;
  return (
    direct ||
    message.content.some(
      (span) => span.type === "mention" && "user_id" in span && span.user_id === me,
    )
  );
}

/** The handoffs for this person among one chat's messages. */
export function incomingHandoffs(
  messages: readonly SpaceMessage[],
  me: string,
  direct: boolean,
): IncomingHandoff[] {
  return messages
    .filter((message) => handoffIsFor(message, me, direct))
    .map((message) => ({
      id: message.id,
      conversationId: message.conversation_id ?? "",
      fromUserId: message.sender_user_id,
      fromName: message.sender_name,
      text: readSpacePost(message)!.text,
      createdAt: message.created_at,
    }));
}

/** The handoffs still waiting: not given to an agent or dismissed on this device. Newest first. */
export function pendingHandoffs(
  handoffs: readonly IncomingHandoff[],
  handled: readonly string[],
): IncomingHandoff[] {
  const done = new Set(handled);
  const seen = new Set<string>();
  return handoffs
    .filter((handoff) => {
      if (done.has(handoff.id) || seen.has(handoff.id)) return false;
      seen.add(handoff.id);
      return true;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export interface Claim {
  id: string;
  userId: string;
  name: string;
  text: string;
  createdAt: string;
}

/** Whether something posted at `createdAt` is still inside a claim's day. */
export function claimIsFresh(createdAt: string, now: number): boolean {
  const posted = Date.parse(createdAt);
  return Number.isFinite(posted) && now - posted < claimLifetimeMs;
}

/** The claims members posted in the Space's main chat in the last day, newest first. */
export function activeClaims(messages: readonly SpaceMessage[], now: number): Claim[] {
  const claims: Claim[] = [];
  for (const message of messages) {
    if (message.local_delivery_state || !claimIsFresh(message.created_at, now)) continue;
    const post = readSpacePost(message);
    if (post?.kind !== "claim") continue;
    claims.push({
      id: message.id,
      userId: message.sender_user_id,
      name: message.sender_name,
      text: post.text,
      createdAt: message.created_at,
    });
  }
  return claims.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// Words too common to say two people are on the same thing.
const fillerWords = new Set(
  (
    "the and for with from into onto this that these those have has had will are was were been " +
    "i'm im its it's our your their them then than about some more just still also work working " +
    "doing fix fixing add adding make making page"
  ).split(" "),
);

function claimWords(text: string): Set<string> {
  return new Set(
    text
      .toLocaleLowerCase()
      .split(/[^\p{L}\p{N}'’]+/u)
      .filter((word) => word.length > 2 && !fillerWords.has(word)),
  );
}

/**
 * Another member's active claim that shares a word with what this person is typing. It is only
 * ever a warning: the claim can still be posted.
 */
export function overlappingClaim(
  draft: string,
  claims: readonly Claim[],
  me: string,
): Claim | undefined {
  const words = claimWords(draft);
  if (!words.size) return undefined;
  return claims.find(
    (claim) => claim.userId !== me && [...claimWords(claim.text)].some((word) => words.has(word)),
  );
}

/** "5 min ago", "3 h ago": how long ago a claim or handoff was posted. */
export function postedAgo(createdAt: string, now: number): string {
  const minutes = Math.floor((now - Date.parse(createdAt)) / 60_000);
  if (!Number.isFinite(minutes) || minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.floor(hours / 24)} d ago`;
}
