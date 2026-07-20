import type { WorkflowNodeKind, WorkflowRisk } from "./v2";

export type ProviderTier = "full" | "content" | "meeting";
export type ProviderAuth = "oauth" | "oauth_install";

export interface ProviderDefinition {
  id: string;
  name: string;
  tier: ProviderTier;
  auth: ProviderAuth;
  color: string;
  description: string;
  capabilities: string[];
}

export interface ProviderNodeTemplate {
  id: string;
  providerId: string;
  label: string;
  description: string;
  category: "Triggers" | "Files" | "Integrations" | "Actions";
  kind: WorkflowNodeKind;
  risk: WorkflowRisk;
  capability: string;
  operation: string;
  defaults?: Record<string, unknown>;
}

export const providerCatalog: readonly ProviderDefinition[] = [
  provider(
    "google",
    "Google",
    "full",
    "oauth",
    "#4285f4",
    "One Google account connection for Calendar and future Google capabilities. Calendar events are read-only and must be explicitly published to a Space.",
    ["calendar.read", "calendar.watch"],
  ),
  provider(
    "slack",
    "Slack",
    "full",
    "oauth_install",
    "#611f69",
    "Selected channel messages, mentions, threads, files, and approved bot replies.",
    ["messages.read", "messages.watch", "messages.write"],
  ),
  provider(
    "discord",
    "Discord",
    "full",
    "oauth_install",
    "#5865f2",
    "Selected bot-scoped messages, mentions, threads, attachments, and approved replies.",
    ["messages.read", "messages.watch", "messages.write"],
  ),
  provider(
    "notion",
    "Notion",
    "content",
    "oauth_install",
    "#8d8d8d",
    "Selected pages, data sources, blocks, attachments, and changes.",
    ["content.read", "content.watch"],
  ),
] as const;

export const providerNodeTemplates: readonly ProviderNodeTemplate[] = providerCatalog.flatMap(
  (item) => {
    const templates: ProviderNodeTemplate[] = [];
    const domain =
      item.tier === "meeting"
        ? "meeting"
        : item.tier === "content"
          ? "content"
          : item.id.includes("calendar")
            ? "event"
            : "message";
    templates.push({
      id: `${item.id}.watch`,
      providerId: item.id,
      label: `New ${item.name} ${domain}`,
      description: `Start when an authorized ${item.name} ${domain} changes.`,
      category: "Triggers",
      kind: "connector_trigger",
      risk: "read",
      capability: `${item.id}.watch`,
      operation: "watch",
      defaults: { filters: {} },
    });
    templates.push({
      id: `${item.id}.query`,
      providerId: item.id,
      label: `Find ${item.name} ${domain}s`,
      description: `Query authorized ${item.name} resources.`,
      category: item.tier === "content" ? "Files" : "Integrations",
      kind: "source_query",
      risk: "read",
      capability: `${item.id}.read`,
      operation: "query",
      defaults: { query: "", limit: 50 },
    });
    if (item.id === "slack" || item.id === "discord") {
      templates.push({
        id: `${item.id}.write`,
        providerId: item.id,
        label: `Reply with ${item.name}`,
        description: `Draft a bot reply that always requires per-action approval.`,
        category: "Actions",
        kind: "exact_tool",
        risk: "write",
        capability: `${item.id}.write`,
        operation: "write",
        defaults: { destination: "", mode: "draft" },
      });
    }
    return templates;
  },
);

export function providerById(id: string | undefined): ProviderDefinition | undefined {
  return providerCatalog.find((item) => item.id === id);
}

function provider(
  id: string,
  name: string,
  tier: ProviderTier,
  auth: ProviderAuth,
  color: string,
  description: string,
  capabilities: string[],
): ProviderDefinition {
  return { id, name, tier, auth, color, description, capabilities };
}
