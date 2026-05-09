import { spaceRequest } from "@/api/spaces/api";
import type {
  SlackLinkDirection,
  SlackLinkResult,
  SlackPublishResult,
  SpaceSlackLink,
} from "@/api/spaces/dto/interfaces/connections/slack";

const part = encodeURIComponent;

export const spaceSlackApi = {
  links: (spaceId: string) =>
    spaceRequest<{ links: SpaceSlackLink[] }>(`/spaces/${part(spaceId)}/integrations/slack/links`),
  createLink: (
    spaceId: string,
    input: {
      integration_id: string;
      channel_id: string;
      conversation_id?: string;
      direction: SlackLinkDirection;
    },
  ) =>
    spaceRequest<SlackLinkResult>(`/spaces/${part(spaceId)}/integrations/slack/links`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateLink: (spaceId: string, linkId: string, direction: SlackLinkDirection) =>
    spaceRequest<{ link: SpaceSlackLink }>(
      `/spaces/${part(spaceId)}/integrations/slack/links/${part(linkId)}`,
      { method: "PATCH", body: JSON.stringify({ direction }) },
    ),
  deleteLink: (spaceId: string, linkId: string) =>
    spaceRequest<void>(`/spaces/${part(spaceId)}/integrations/slack/links/${part(linkId)}`, {
      method: "DELETE",
    }),
  sync: (spaceId: string, linkId: string) =>
    spaceRequest<SlackLinkResult>(
      `/spaces/${part(spaceId)}/integrations/slack/links/${part(linkId)}/sync`,
      { method: "POST" },
    ),
  publishMessage: (spaceId: string, linkId: string, messageId: string, threadTs = "") =>
    spaceRequest<SlackPublishResult>(
      `/spaces/${part(spaceId)}/integrations/slack/links/${part(linkId)}/publish`,
      { method: "POST", body: JSON.stringify({ message_id: messageId, thread_ts: threadTs }) },
    ),
};
