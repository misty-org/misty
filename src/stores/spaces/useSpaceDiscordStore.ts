import { spaceRequest } from "@/stores/spaces/useSpacesBackendStore";
import type {
  DiscordSyncResult,
  SpaceDiscordLink,
} from "@/models/interfaces/features/spaces/connections/discord";
import type { SpaceMessage } from "@/models/interfaces/features/spaces/types";
import type { DiscordLinkDirection } from "@/models/types/features/spaces/connections/discord";

const part = encodeURIComponent;

/**
 * Space ↔ Discord link management.
 *
 * Every Discord network call is made by the Misty server, never by the desktop
 * client: the bot token lives behind the `SpaceIntegration` credential and must
 * not reach the renderer. The client's job is to name the channel, ask for a
 * sync, and approve individual outbound messages.
 */
export const spaceDiscordApi = {
  /** Every Discord channel linked to this Space. */
  links: (spaceId: string) =>
    spaceRequest<{ links: SpaceDiscordLink[] }>(
      `/spaces/${part(spaceId)}/integrations/discord/links`,
    ),

  /**
   * Binds a Discord channel to a Misty conversation. The server resolves the
   * guild, verifies the bot can read and post, and stores the link `pending`
   * until the first sync succeeds.
   */
  createLink: (
    spaceId: string,
    input: {
      integration_id: string;
      conversation_id: string;
      channel_id: string;
      channel_name: string;
      guild_id: string;
      guild_name: string;
      direction: DiscordLinkDirection;
    },
  ) =>
    spaceRequest<SpaceDiscordLink>(`/spaces/${part(spaceId)}/integrations/discord/links`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  /** Changes the allowed mirror direction without dropping the cursor. */
  updateLink: (spaceId: string, linkId: string, patch: { direction: DiscordLinkDirection }) =>
    spaceRequest<SpaceDiscordLink>(
      `/spaces/${part(spaceId)}/integrations/discord/links/${part(linkId)}`,
      { method: "PATCH", body: JSON.stringify(patch) },
    ),

  /** Unlinks the channel. Already-mirrored messages stay in the Space. */
  deleteLink: (spaceId: string, linkId: string) =>
    spaceRequest<void>(`/spaces/${part(spaceId)}/integrations/discord/links/${part(linkId)}`, {
      method: "DELETE",
    }),

  /**
   * Pulls messages after the stored cursor. Safe to call repeatedly — the
   * cursor makes it idempotent, so a retry cannot duplicate a transcript.
   */
  sync: (spaceId: string, linkId: string) =>
    spaceRequest<DiscordSyncResult>(
      `/spaces/${part(spaceId)}/integrations/discord/links/${part(linkId)}/sync`,
      { method: "POST" },
    ),

  /**
   * Publishes one Misty message to Discord. Explicit and per-message by design:
   * an outward write is never a silent side effect of sending in Misty.
   */
  publishMessage: (spaceId: string, linkId: string, messageId: string) =>
    spaceRequest<{ message: SpaceMessage }>(
      `/spaces/${part(spaceId)}/integrations/discord/links/${part(linkId)}/publish`,
      { method: "POST", body: JSON.stringify({ message_id: messageId }) },
    ),
};
