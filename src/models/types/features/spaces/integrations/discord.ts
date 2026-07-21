/**
 * Which way messages are allowed to travel across a Space ↔ Discord link.
 * Beta ships `two_way`; the narrower modes exist so a Space can be put into a
 * read-only or announce-only posture without tearing the link down.
 */
export type DiscordLinkDirection = "two_way" | "inbound" | "outbound";

/**
 * Mirrors the vocabulary `SpaceCalendarSource` already uses so every Space
 * integration reports health in the same words.
 */
export type DiscordLinkStatus = "pending" | "syncing" | "active" | "needs_attention" | "disabled";

/**
 * Why a link stopped working. The UI maps these to plain sentences instead of
 * surfacing raw Discord error bodies.
 */
export type DiscordLinkErrorCode =
  | "missing_access"
  | "unknown_channel"
  | "rate_limited"
  | "token_expired"
  | "webhook_missing"
  | "unknown";

/** Where a mirrored Space message came from, and where it was published to. */
export type MessageOriginSystem = "misty" | "discord";

/**
 * Outcome of publishing one Misty message outward. `skipped` covers messages
 * that must never leave Misty — system notices and agent output.
 */
export type MessagePublishState =
  "not_published" | "publishing" | "published" | "failed" | "skipped";
