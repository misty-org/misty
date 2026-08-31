import { spaceRequest } from "@/api/spaces/api";

export interface FigmaProject {
  id: string;
  name: string;
}

export interface FigmaFileSummary {
  key: string;
  name: string;
  thumbnail_url?: string;
  last_modified?: string;
}

export interface FigmaBinding {
  id: string;
  space_id: string;
  connection_id: string;
  integration_id: string;
  shared_resource_id: string;
  bound_by_user_id: string;
  resource_type: "file" | "project";
  external_id: string;
  display_name: string;
  team_id?: string;
  project_id?: string;
  file_key?: string;
  sync_cursor?: string;
  status: "pending" | "active" | "needs_attention" | "disabled";
  last_error_code?: string;
  last_synced_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface FigmaContentRecord {
  id: string;
  binding_id: string;
  file_key: string;
  record_type: "file" | "version" | "comment" | "webhook_event";
  external_id: string;
  parent_external_id?: string;
  title?: string;
  actor_id?: string;
  actor_name?: string;
  resolved?: boolean;
  provenance: Record<string, unknown>;
  occurred_at?: string | null;
}

export interface FigmaVersion {
  id: string;
  created_at: string;
  label?: string;
  description?: string;
  user?: Record<string, unknown>;
}

export interface FigmaComment {
  id: string;
  message: string;
  created_at: string;
  resolved_at?: string | null;
  user?: Record<string, unknown>;
  client_meta?: Record<string, unknown>;
}

export interface FigmaFileContext {
  key: string;
  name: string;
  version: string;
  last_modified: string;
  editor_type: string;
  thumbnail_url?: string;
  document_summary?: Record<string, unknown>;
}

export interface FigmaBindingContext {
  file: FigmaFileContext;
  versions: FigmaVersion[];
  comments: FigmaComment[];
}

export interface FigmaWebhookSubscription {
  id: string;
  binding_id: string;
  webhook_id: string;
  event_type: string;
  status: string;
  last_error_code?: string;
}

const base = (spaceId: string) => `/spaces/${encodeURIComponent(spaceId)}/drawings/figma`;
const bindingPath = (spaceId: string, bindingId: string) =>
  `${base(spaceId)}/bindings/${encodeURIComponent(bindingId)}`;

export const figmaDrawingsApi = {
  projects: (connectionId: string, teamId: string) =>
    spaceRequest<{ projects: FigmaProject[] }>(
      `/figma/teams/${encodeURIComponent(teamId)}/projects?connection_id=${encodeURIComponent(connectionId)}`,
    ),

  projectFiles: (connectionId: string, projectId: string) =>
    spaceRequest<{ files: FigmaFileSummary[] }>(
      `/figma/projects/${encodeURIComponent(projectId)}/files?connection_id=${encodeURIComponent(connectionId)}`,
    ),

  bindings: (spaceId: string) =>
    spaceRequest<{ bindings: FigmaBinding[] }>(`${base(spaceId)}/bindings`),

  bind: (
    spaceId: string,
    input: {
      connection_id: string;
      resource_type: "file" | "project";
      team_id?: string;
      project_id?: string;
      file_key?: string;
    },
  ) =>
    spaceRequest<{ binding: FigmaBinding; records_synced: number }>(`${base(spaceId)}/bindings`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  unbind: (spaceId: string, bindingId: string) =>
    spaceRequest<void>(bindingPath(spaceId, bindingId), { method: "DELETE" }),

  sync: (spaceId: string, bindingId: string) =>
    spaceRequest<{ binding: FigmaBinding; records_synced: number }>(
      `${bindingPath(spaceId, bindingId)}/sync`,
      { method: "POST" },
    ),

  reconcileWebhooks: (spaceId: string, bindingId: string) =>
    spaceRequest<{ binding: FigmaBinding; subscriptions: FigmaWebhookSubscription[] }>(
      `${bindingPath(spaceId, bindingId)}/reconcile-webhooks`,
      { method: "POST" },
    ),

  records: (spaceId: string, bindingId: string, query = "") => {
    const params = new URLSearchParams({ limit: "100" });
    if (query.trim()) params.set("query", query.trim());
    return spaceRequest<{ records: FigmaContentRecord[] }>(
      `${bindingPath(spaceId, bindingId)}/records?${params}`,
    );
  },

  context: (spaceId: string, bindingId: string, fileKey = "") => {
    const query = fileKey ? `?file_key=${encodeURIComponent(fileKey)}` : "";
    return spaceRequest<FigmaBindingContext>(`${bindingPath(spaceId, bindingId)}/context${query}`);
  },

  comment: (
    spaceId: string,
    bindingId: string,
    input: {
      file_key?: string;
      message: string;
      node_id?: string;
      confirmed: true;
      idempotency_key: string;
    },
  ) =>
    spaceRequest<{ comment: FigmaComment }>(`${bindingPath(spaceId, bindingId)}/comments`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
};

export function figmaFileUrl(fileKey: string, nodeId = ""): string {
  const url = new URL(`https://www.figma.com/file/${encodeURIComponent(fileKey)}`);
  if (nodeId) url.searchParams.set("node-id", nodeId);
  return url.toString();
}

export function parseFigmaFileKey(value: string): string {
  const trimmed = value.trim();
  if (/^[A-Za-z0-9_-]{6,}$/.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    if (
      url.protocol !== "https:" ||
      !["figma.com", "www.figma.com"].includes(url.hostname.toLowerCase()) ||
      url.username ||
      url.password
    )
      return "";
    const parts = url.pathname.split("/").filter(Boolean);
    if (!["file", "design", "board"].includes(parts[0] ?? "")) return "";
    const candidate = parts[1] ?? "";
    return /^[A-Za-z0-9_-]{6,}$/.test(candidate) ? candidate : "";
  } catch {
    return "";
  }
}
