import { apiRequest } from "@/api/client";
import type {
  SocialAutomationRule,
  SocialBinding,
  SocialProvider,
  SocialResource,
  SocialScheduledMessage,
  SocialSendAuthority,
} from "./types";

const part = encodeURIComponent;

export const socialApi = {
  providers: (spaceId: string) =>
    apiRequest<{ providers: SocialProvider[] }>(`/spaces/${part(spaceId)}/social/providers`),
  bindings: (spaceId: string) =>
    apiRequest<{ bindings: SocialBinding[] }>(`/spaces/${part(spaceId)}/social/bindings`),
  resources: (connectionId: string) =>
    apiRequest<{ provider: string; resources: SocialResource[] }>(
      `/connections/${part(connectionId)}/social/resources`,
    ),
  bind: (
    spaceId: string,
    input: {
      connection_id: string;
      provider: string;
      external_resource_id: string;
      external_parent_id?: string;
      display_name: string;
    },
  ) =>
    apiRequest<SocialBinding>(`/spaces/${part(spaceId)}/social/bindings`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  unbind: (spaceId: string, bindingId: string) =>
    apiRequest<void>(`/spaces/${part(spaceId)}/social/bindings/${part(bindingId)}`, {
      method: "DELETE",
    }),
  grantAuthority: (
    spaceId: string,
    input: {
      connection_id: string;
      binding_id?: string;
      allow_manual: boolean;
      allow_scheduled: boolean;
      allow_automation: boolean;
    },
  ) =>
    apiRequest<SocialSendAuthority>(`/spaces/${part(spaceId)}/social/authorities`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  authorities: (spaceId: string) =>
    apiRequest<{ authorities: SocialSendAuthority[] }>(
      `/spaces/${part(spaceId)}/social/authorities`,
    ),
  automationRules: (spaceId: string) =>
    apiRequest<{ rules: SocialAutomationRule[] }>(
      `/spaces/${part(spaceId)}/social/automation-rules`,
    ),
  saveAutomationRule: (spaceId: string, input: Partial<SocialAutomationRule>) =>
    apiRequest<SocialAutomationRule>(`/spaces/${part(spaceId)}/social/automation-rules`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  scheduledMessages: (spaceId: string) =>
    apiRequest<{ scheduled_messages: SocialScheduledMessage[] }>(
      `/spaces/${part(spaceId)}/social/scheduled-messages`,
    ),
  schedule: (
    spaceId: string,
    input: {
      binding_id: string;
      conversation_id: string;
      authority_id: string;
      content: Array<{ type: "text"; text: string }>;
      scheduled_at: string;
      timezone: string;
    },
  ) =>
    apiRequest<SocialScheduledMessage>(`/spaces/${part(spaceId)}/social/scheduled-messages`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  cancelScheduled: (spaceId: string, scheduledId: string) =>
    apiRequest<void>(`/spaces/${part(spaceId)}/social/scheduled-messages/${part(scheduledId)}`, {
      method: "DELETE",
    }),
};
