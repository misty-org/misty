import type {
  DiscordMessage,
  DiscordOutboundPayload,
  MessageOrigin,
  MirroredMessageInput,
  SpaceDiscordLink,
} from "@/api/spaces/dto/interfaces/connections/discord";
import type { SpaceMessage } from "@/api/spaces/dto/interfaces/types";
import type { MessageSpan } from "@/api/spaces/dto/types/types";

/**
 * Pure translation between Discord's wire format and Misty's message model.
 *
 * Everything here is deliberately side-effect free: the sync service decides
 * *when* to move messages, this module decides only *what* they become. That
 * split is what makes the loop-prevention and cursor rules testable without a
 * Discord account.
 */

/** Discord message types Misty mirrors. 0 = default, 19 = inline reply. */
const MIRRORED_MESSAGE_TYPES = new Set([0, 19]);

/** `<@1234>` and `<@!1234>` — a user mention in Discord's raw content. */
const USER_MENTION_PATTERN = /<@!?(\d+)>/g;
/** `<#1234>` — a channel mention. */
const CHANNEL_MENTION_PATTERN = /<#(\d+)>/g;
/** `<@&1234>` — a role mention. */
const ROLE_MENTION_PATTERN = /<@&(\d+)>/g;

export interface DiscordMappingContext {
  /** Discord user id → Misty user id, for members who linked both accounts. */
  misty_user_ids?: Record<string, string>;
  /** Discord user/role/channel id → display label, for readable mentions. */
  labels?: Record<string, string>;
}

/**
 * Should this Discord message become a Misty message?
 *
 * The bot-echo rule is what stops an infinite mirror loop: anything Misty itself
 * posted comes back down the same channel read, and must be dropped before it is
 * imported and re-published.
 */
export function shouldMirrorDiscordMessage(
  message: DiscordMessage,
  link: Pick<SpaceDiscordLink, "bot_user_id" | "direction">,
): boolean {
  if (link.direction === "outbound") return false;
  if (message.type !== undefined && !MIRRORED_MESSAGE_TYPES.has(message.type)) return false;
  if (link.bot_user_id && message.author.id === link.bot_user_id) return false;
  if (message.webhook_id) return false;
  // A message with neither text nor attachments carries nothing to mirror.
  return Boolean(message.content.trim() || message.attachments?.length);
}

/** Should this Misty message be published outward? */
export function shouldPublishToDiscord(
  message: Pick<SpaceMessage, "sender_kind" | "content"> & { origin?: MessageOrigin },
  link: Pick<SpaceDiscordLink, "direction">,
): boolean {
  if (link.direction === "inbound") return false;
  // Never bounce a Discord-sourced message back to Discord.
  if (message.origin && message.origin.system !== "misty") return false;
  // Agent output and system notices stay inside the Space.
  if (message.sender_kind !== "person") return false;
  return Boolean(spansToText(message.content).trim());
}

/**
 * Discord message → the payload Misty's message API accepts.
 *
 * Discord content is plain text with id-based mention tokens; Misty content is
 * spans. Mentions that resolve to a Misty member become real mention spans so
 * they highlight and notify; the rest degrade to readable text rather than
 * leaking `<@980…>` into the transcript.
 */
export function discordMessageToMirroredMessage(
  message: DiscordMessage,
  context: DiscordMappingContext = {},
): MirroredMessageInput {
  const attachmentUrls = (message.attachments ?? []).map((attachment) => attachment.url);
  const origin: MessageOrigin = {
    system: "discord",
    external_id: message.id,
    external_channel_id: message.channel_id,
    author_name: discordDisplayName(message.author),
    author_handle: message.author.username,
    authored_at: message.timestamp,
    ...(discordAvatarUrl(message.author)
      ? { author_avatar_url: discordAvatarUrl(message.author) }
      : {}),
    ...(attachmentUrls.length ? { attachment_urls: attachmentUrls } : {}),
  };
  return {
    content: discordContentToSpans(message, context),
    sender_name: discordDisplayName(message.author),
    origin,
    ...(message.referenced_message ? { reply_to_external_id: message.referenced_message.id } : {}),
  };
}

/**
 * Misty message → Discord payload.
 *
 * `allowed_mentions.parse` is always empty. Mirroring must never let a Misty
 * message ping a whole Discord server, even when the text contains "@everyone".
 */
export function spaceMessageToDiscordPayload(
  message: Pick<SpaceMessage, "content" | "sender_name">,
  options: { replyToExternalId?: string; avatarUrl?: string } = {},
): DiscordOutboundPayload {
  return {
    content: truncateForDiscord(spansToText(message.content).trim()),
    username: message.sender_name || "Misty",
    allowed_mentions: { parse: [] },
    ...(options.avatarUrl ? { avatar_url: options.avatarUrl } : {}),
    ...(options.replyToExternalId
      ? { message_reference: { message_id: options.replyToExternalId } }
      : {}),
  };
}

/**
 * Advance the sync cursor. Discord snowflakes are numeric strings of varying
 * length, so a plain string comparison would order "9" after "10" — compare as
 * integers and keep the existing cursor when a page arrives out of order.
 */
export function nextSyncCursor(
  current: string | undefined,
  messages: Array<Pick<DiscordMessage, "id">>,
): string | undefined {
  return messages.reduce<string | undefined>(
    (highest, message) => (isSnowflakeAfter(message.id, highest) ? message.id : highest),
    current,
  );
}

/** True when `candidate` is a strictly newer snowflake than `reference`. */
export function isSnowflakeAfter(candidate: string, reference: string | undefined): boolean {
  if (!reference) return true;
  try {
    return BigInt(candidate) > BigInt(reference);
  } catch {
    // A malformed id must never advance the cursor past real messages.
    return false;
  }
}

/** Flattens Misty spans to the plain text Discord expects. */
export function spansToText(spans: MessageSpan[]): string {
  return spans.map((span) => (span.type === "text" ? span.text : `@${span.label}`)).join("");
}

/** Discord's per-message limit. Mirrored text is trimmed, never dropped. */
const DISCORD_CONTENT_LIMIT = 2000;

function truncateForDiscord(content: string): string {
  if (content.length <= DISCORD_CONTENT_LIMIT) return content;
  return `${content.slice(0, DISCORD_CONTENT_LIMIT - 1)}…`;
}

function discordContentToSpans(
  message: DiscordMessage,
  context: DiscordMappingContext,
): MessageSpan[] {
  const readable = readableDiscordText(message.content, context);
  const spans = splitUserMentions(readable, context);
  const attachments = message.attachments ?? [];
  if (!attachments.length) return spans.length ? spans : [{ type: "text", text: "" }];
  const summary = attachments.map((attachment) => attachment.filename).join(", ");
  const prefix = spans.length ? "\n" : "";
  return [...spans, { type: "text", text: `${prefix}📎 ${summary}` }];
}

/** Rewrites channel and role tokens to labels; user tokens are handled as spans. */
function readableDiscordText(content: string, context: DiscordMappingContext): string {
  const labels = context.labels ?? {};
  return content
    .replace(CHANNEL_MENTION_PATTERN, (token, id: string) =>
      labels[id] ? `#${labels[id]}` : token,
    )
    .replace(ROLE_MENTION_PATTERN, (token, id: string) => (labels[id] ? `@${labels[id]}` : token));
}

/**
 * Turns `<@id>` tokens into Misty mention spans when the Discord account maps to
 * a Misty member, and into `@label` text otherwise.
 */
function splitUserMentions(content: string, context: DiscordMappingContext): MessageSpan[] {
  const mistyUserIds = context.misty_user_ids ?? {};
  const labels = context.labels ?? {};
  const spans: MessageSpan[] = [];
  let cursor = 0;

  for (const match of content.matchAll(USER_MENTION_PATTERN)) {
    const discordId = match[1];
    const index = match.index ?? 0;
    const label = labels[discordId] ?? discordId;
    const mistyUserId = mistyUserIds[discordId];
    if (index > cursor) spans.push({ type: "text", text: content.slice(cursor, index) });
    if (mistyUserId) spans.push({ type: "mention", user_id: mistyUserId, label });
    else spans.push({ type: "text", text: `@${label}` });
    cursor = index + match[0].length;
  }

  if (cursor < content.length) spans.push({ type: "text", text: content.slice(cursor) });
  return spans.filter((span) => span.type !== "text" || span.text.length > 0);
}

function discordDisplayName(author: DiscordMessage["author"]): string {
  return author.global_name?.trim() || author.username || "Discord user";
}

function discordAvatarUrl(author: DiscordMessage["author"]): string | undefined {
  if (!author.avatar) return undefined;
  return `https://cdn.discordapp.com/avatars/${author.id}/${author.avatar}.png`;
}
