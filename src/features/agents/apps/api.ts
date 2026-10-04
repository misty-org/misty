import { apiRequest } from "@/api/client";

/** An app account connected to the Misty account. Every agent can use it. */
export interface ConnectedApp {
  id: string;
  app: string;
  name: string;
  alias?: string;
  status: "active" | "pending" | "needs_attention";
  created_at: string;
}

export interface CatalogApp {
  app: string;
  name: string;
  description: string;
  connected: boolean;
}

/** What an agent needs from the user to continue: connect an app or approve one action. */
export interface AppRequest {
  id: string;
  kind: "connect" | "approve";
  subject: string;
  title: string;
  summary: string;
  state: "pending" | "connected" | "approved" | "used" | "declined" | "expired";
  expiresAt: string;
}

const requestPath = (id: string) => `/me/app-requests/${encodeURIComponent(id)}`;

export const appsApi = {
  list: () => apiRequest<{ available: boolean; apps: ConnectedApp[] }>("/integrations/apps"),
  catalog: (search: string, cursor = "") =>
    apiRequest<{ apps: CatalogApp[]; next_cursor: string }>(
      `/integrations/apps/catalog?${new URLSearchParams({ search, cursor })}`,
    ),
  connect: (app: string) =>
    apiRequest<{ url: string }>("/integrations/apps/connect", {
      method: "POST",
      body: JSON.stringify({ app }),
    }),
  disconnect: (id: string) =>
    apiRequest<void>(`/integrations/apps/connections/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  request: (id: string) => apiRequest<{ request: AppRequest }>(requestPath(id)),
  requestLink: (id: string) =>
    apiRequest<{ url: string }>(`${requestPath(id)}/link`, { method: "POST" }),
  decide: (id: string, decision: "approve" | "decline") =>
    apiRequest<{ request: AppRequest }>(requestPath(id), {
      method: "POST",
      body: JSON.stringify({ decision }),
    }),
};
