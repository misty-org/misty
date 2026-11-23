import type { SpaceMessage } from "../api/dto/entities";

const handoffMark = "Handoff:";
const claimMark = "Working on:";

export const claimLifetimeMs = 24 * 60 * 60 * 1000;
export const claimMaxLength = 140;

type PostMessage = Pick<SpaceMessage, "sender_kind" | "content" | "origin">;

export type SpacePost = { kind: "handoff" | "claim"; text: string };

export function handoffBody(text: string): string {
  return `${handoffMark}\n${text.trim()}`;
}

export function claimBody(text: string): string {
  return `${claimMark} ${text.replace(/\s+/g, " ").trim().slice(0, claimMaxLength)}`;
}

export function plainText(content: SpaceMessage["content"]): string {
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
  agentId?: string;
  conversationId: string;
  fromUserId: string;
  fromName: string;
  text: string;
  createdAt: string;
}

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

export function incomingHandoffs(
  messages: readonly SpaceMessage[],
  me: string,
  direct: boolean,
): IncomingHandoff[] {
  return messages
    .filter((message) => handoffIsFor(message, me, direct))
    .map((message) => {
      const agent = message.content.find(
        (span): span is Extract<typeof span, { agent_id: string }> =>
          span.type === "mention" && "agent_id" in span,
      );
      const words = agent
        ? readSpacePost({ ...message, content: message.content.filter((span) => span !== agent) })
        : undefined;
      return {
        id: message.id,
        ...(agent ? { agentId: agent.agent_id } : {}),
        conversationId: message.conversation_id ?? "",
        fromUserId: message.sender_user_id,
        fromName: message.sender_name,
        text: (words ?? readSpacePost(message)!).text,
        createdAt: message.created_at,
      };
    });
}

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

interface Claim {
  id: string;
  userId: string;
  name: string;
  text: string;
  createdAt: string;
}

function claimIsFresh(createdAt: string, now: number): boolean {
  const posted = Date.parse(createdAt);
  return Number.isFinite(posted) && now - posted < claimLifetimeMs;
}

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

export function postedAgo(createdAt: string, now: number): string {
  const minutes = Math.floor((now - Date.parse(createdAt)) / 60_000);
  if (!Number.isFinite(minutes) || minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.floor(hours / 24)} d ago`;
}
