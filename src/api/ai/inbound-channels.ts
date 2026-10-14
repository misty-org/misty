import { apiRequest } from "@/api/client";

/** Email or Slack, watched for tasks the person writes to Misty (roadmap C8). */
export type InboundChannelKind = "gmail" | "slack";

export interface InboundChannel {
  channel: InboundChannelKind;
  enabled: boolean;
  /** Gmail: address and task_address (forward to it). Slack: user_id and team_id. */
  identity: { address?: string; task_address?: string; user_id?: string; team_id?: string };
  watch_after: string;
  last_checked_at?: string;
  last_error?: string;
}

export const inboundChannelsApi = {
  list: () =>
    apiRequest<{ channels: InboundChannel[] }>("/ai/inbound-channels", { cache: "no-store" }),
  enable: (channel: InboundChannelKind) =>
    apiRequest<{ channel: InboundChannel }>(`/ai/inbound-channels/${channel}`, { method: "PUT" }),
  disable: (channel: InboundChannelKind) =>
    apiRequest<void>(`/ai/inbound-channels/${channel}`, { method: "DELETE" }),
};
