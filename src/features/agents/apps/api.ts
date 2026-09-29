import { cachedRequest } from "@/api/cache/cachedRequest";
import { apiRequest } from "@/api/client";

/** An app account connected to the Misty account. Every agent can use it. */
export interface ConnectedApp {
  id: string;
  app: string;
  name: string;
  alias?: string;
  /** Who the connection signed in as: an email address or username, when the app reveals it. */
  account?: string;
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
  /** "Accept and remember" is offered; the label names the exact scope, written by the server. */
  rememberable?: boolean;
  rememberLabel?: string;
  /** The run's Ask or Auto when it paused. */
  permissionMode?: "ask" | "auto";
  /** A remembered payment covers this merchant up to this amount per payment. */
  paymentCap?: { max_amount_minor: number; currency: string };
}

/** The answer to an approval card: this time only, this time and from now on, or no. */
export type AppRequestDecision = "continue" | "remember" | "deny";

const requestPath = (id: string) => `/me/app-requests/${encodeURIComponent(id)}`;

export const appsApi = {
  list: (onCached?: (value: { available: boolean; apps: ConnectedApp[] }) => void) =>
    cachedRequest<{ available: boolean; apps: ConnectedApp[] }>("/integrations/apps", {
      onCached,
    }),
  catalog: (
    search: string,
    cursor = "",
    onCached?: (value: { apps: CatalogApp[]; next_cursor: string }) => void,
  ) =>
    cachedRequest<{ apps: CatalogApp[]; next_cursor: string }>(
      `/integrations/apps/catalog?${new URLSearchParams({ search, cursor })}`,
      { onCached },
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
  decide: (id: string, decision: AppRequestDecision) =>
    apiRequest<{ request: AppRequest }>(requestPath(id), {
      method: "POST",
      body: JSON.stringify({ decision }),
    }),
};
