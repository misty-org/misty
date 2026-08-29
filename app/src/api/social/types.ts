export type SocialProviderId = "misty" | "instagram" | "discord" | "messenger" | "x";

export interface SocialCapabilitySet {
  Read?: boolean;
  Send?: boolean;
  Schedule?: boolean;
  Automate?: boolean;
  DeliveryReceipts?: boolean;
  read?: boolean;
  send?: boolean;
  schedule?: boolean;
  automate?: boolean;
  delivery_receipts?: boolean;
}

export interface SocialProvider {
  id: SocialProviderId;
  name: string;
  configured: boolean;
  capabilities: SocialCapabilitySet;
}

export interface SocialBinding {
  id: string;
  space_id: string;
  connection_id: string;
  conversation_id: string;
  provider: Exclude<SocialProviderId, "misty">;
  external_resource_id: string;
  external_parent_id?: string;
  display_name: string;
  direction: "two_way" | "inbound" | "outbound";
  status: "pending" | "syncing" | "active" | "needs_attention" | "disabled";
  capabilities: SocialCapabilitySet;
  last_error_code?: string;
}

export interface SocialResource {
  id: string;
  parent_id?: string;
  name: string;
  kind: string;
}

export interface SocialSendAuthority {
  id: string;
  space_id: string;
  connection_id: string;
  binding_id?: string;
  allow_manual: boolean;
  allow_scheduled: boolean;
  allow_automation: boolean;
  hourly_limit: number;
  daily_limit: number;
}

export interface SocialAutomationRule {
  id: string;
  space_id: string;
  binding_id: string;
  conversation_id?: string;
  authority_id: string;
  name: string;
  instructions: string;
  tone: string;
  confidence_threshold: number;
  max_replies_per_hour: number;
  max_replies_per_day: number;
  cooldown_seconds: number;
  max_unanswered_replies: number;
  enabled: boolean;
}

export interface SocialScheduledMessage {
  id: string;
  space_id: string;
  binding_id: string;
  conversation_id: string;
  authority_id: string;
  content: Array<{ type: "text"; text: string }>;
  scheduled_at: string;
  timezone: string;
  status: "scheduled" | "queued" | "sent" | "failed" | "cancelled";
  last_error_code?: string;
}
