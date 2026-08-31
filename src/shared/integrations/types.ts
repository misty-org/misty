export type IntegrationCapability =
  | "mail"
  | "chat"
  | "notes"
  | "calendar"
  | "calendar_read"
  | "calendar_write"
  | "source_control"
  | "shell"
  | "files"
  | "drawings"
  | "drawings_read"
  | "drawings_projects"
  | "drawings_comments"
  | "drawings_webhooks"
  | "social_read"
  | "social_send"
  | "social_automation"
  | "agent_tools";

export type IntegrationConnectionStatus =
  "connected" | "syncing" | "needs_reconnect" | "error" | "disconnected";

export interface IntegrationProviderDefinition {
  id: string;
  name: string;
  capabilities: IntegrationCapability[];
}
