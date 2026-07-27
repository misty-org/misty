import type {
  DiscordLinkDirection,
  DiscordLinkErrorCode,
  DiscordLinkStatus,
  MessageOriginSystem,
  MessagePublishState,
} from "@/models/types/features/spaces/integrations/discord";
import type { MessageSpan } from "@/models/types/features/spaces/types";

/**
 * One Space ↔ Discord channel binding. A Space can contain multiple links, but
 * the record is keyed by conversation so lifting that cap later is additive.
 *
 * No Discord token lives here. The bot token stays server-side behind
 * `credential_reference` on the owning `SpaceIntegration`, exactly like every
 * other Misty provider connection.
 */
export interface SpaceDiscordLink {
  id: string;
  space_id: string;
  /** The `SpaceIntegration` holding the server-side Discord credential. */
  integration_id: string;
  /** Misty conversation that mirrors this channel. */
  conversation_id: string;
  guild_id: string;
  guild_name: string;
  channel_id: string;
  channel_name: string;
  direction: DiscordLinkDirection;
  status: DiscordLinkStatus;
  /**
   * Highest Discord message snowflake already imported. Discord's `after`
   * parameter takes exactly this, so the cursor doubles as the resume point.
   */
  last_message_id?: string;
  last_synced_at?: string;
  last_error_code?: DiscordLinkErrorCode;
  /** Discord user id of the bot, so its own echoes can be filtered out. */
  bot_user_id?: string;
  connected_by_user_id: string;
  disabled_at?: string;
  created_at: string;
  updated_at: string;
}

/** Discord user as returned by the Discord REST API. */
export interface DiscordAuthor {
  id: string;
  username: string;
  global_name?: string | null;
  discriminator?: string;
  avatar?: string | null;
  bot?: boolean;
}

/** Discord attachment. Beta links to attachments rather than mirroring bytes. */
export interface DiscordAttachment {
  id: string;
  filename: string;
  url: string;
  size?: number;
  content_type?: string;
}

/** The subset of a Discord message Misty reads. */
export interface DiscordMessage {
  id: string;
  channel_id: string;
  content: string;
  timestamp: string;
  edited_timestamp?: string | null;
  author: DiscordAuthor;
  attachments?: DiscordAttachment[];
  referenced_message?: { id: string } | null;
  /** 0 = default, 19 = reply. Anything else is a join/pin/system notice. */
  type?: number;
  /** Present when the message was posted through a webhook. */
  webhook_id?: string;
}

/** Payload Misty POSTs to Discord when publishing a message outward. */
export interface DiscordOutboundPayload {
  content: string;
  /** Webhook display name, so Discord shows the Misty author, not the bot. */
  username?: string;
  avatar_url?: string;
  message_reference?: { message_id: string };
  /**
   * Always sent. An empty `parse` array means a mirrored "@everyone" cannot
   * ping a Discord server — Misty never escalates reach on a user's behalf.
   */
  allowed_mentions: { parse: string[] };
}

/**
 * Provenance for a mirrored message. Optional on `SpaceMessage`: a message with
 * no origin is plain Misty-native chat, which keeps every existing caller valid.
 */
export interface MessageOrigin {
  system: MessageOriginSystem;
  /** Discord message snowflake for inbound messages. */
  external_id?: string;
  external_channel_id?: string;
  /** Display name as it appeared in the source system. */
  author_name?: string;
  author_handle?: string;
  author_avatar_url?: string;
  authored_at?: string;
  /** Set on Misty-authored messages that were mirrored outward. */
  publish_state?: MessagePublishState;
  published_at?: string;
  published_external_id?: string;
  publish_error?: string;
  /** Attachment links Discord carried that Misty did not copy into the Library. */
  attachment_urls?: string[];
}

/**
 * A Discord message normalized into the shape Misty's message API accepts. The
 * backend assigns ids and sequence numbers; the client only decides content.
 */
export interface MirroredMessageInput {
  content: MessageSpan[];
  sender_name: string;
  origin: MessageOrigin;
  reply_to_external_id?: string;
}

/** Result of one sync pass over a link. */
export interface DiscordSyncResult {
  link: SpaceDiscordLink;
  imported: number;
  skipped: number;
  cursor?: string;
  /** Present when the pass completed but something needs the user's attention. */
  error?: string;
}
