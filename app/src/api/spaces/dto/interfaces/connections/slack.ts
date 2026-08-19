import type { SpaceMessage } from "../core";

export type SlackLinkDirection = "two_way" | "inbound" | "outbound";
export type SlackLinkStatus = "pending" | "syncing" | "active" | "needs_attention" | "disabled";

export interface SpaceSlackLink {
  id: string;
  space_id: string;
  integration_id: string;
  shared_resource_id: string;
  conversation_id: string;
  connected_by_user_id: string;
  team_id: string;
  team_name: string;
  channel_id: string;
  channel_name: string;
  direction: SlackLinkDirection;
  status: SlackLinkStatus;
  last_message_ts?: string;
  last_synced_at?: string;
  last_error_code?: string;
  bot_user_id?: string;
  disabled_at?: string;
  created_at: string;
  updated_at: string;
}

export interface SlackLinkResult {
  link: SpaceSlackLink;
  imported: number;
}

export interface SlackPublishResult {
  message: SpaceMessage;
}
