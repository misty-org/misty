import { cachedRequest } from "@/api/cache/cachedRequest";
import { apiRequest } from "@/api/client";

/** A Space in the integrations tree. */
export interface AppSpace {
  id: string;
  name: string;
  personal: boolean;
}

/** An app account connected once to the Misty account; each Space picks the accounts it uses. */
export interface ConnectedApp {
  id: string;
  app: string;
  name: string;
  alias?: string;
  /** Who the connection signed in as: an email address or username, when the app reveals it. */
  account?: string;
  status: "active" | "pending" | "needs_attention";
  created_at: string;
  /** Your Spaces that use this account. Private to you, even in a shared Space. */
  spaces: AppSpace[];
}

export interface CatalogApp {
  app: string;
  name: string;
  description: string;
  connected: boolean;
}

/**
 * What an agent needs from the user to continue: connect an app, pick which of their accounts
 * the run's Space uses, or approve one action.
 */
export interface AppRequest {
  id: string;
  kind: "connect" | "pick" | "approve";
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
  /** Answers a pick card: the account becomes one the run's Space uses. */
  pick: (id: string, account: string) =>
    apiRequest<{ request: AppRequest }>(`${requestPath(id)}/pick`, {
      method: "POST",
      body: JSON.stringify({ account }),
    }),
  /** Replaces which of your accounts one Space uses. */
  setSpacePicks: (spaceId: string, accounts: string[]) =>
    apiRequest<{ accounts: { id: string; app: string }[] }>(
      `/integrations/apps/spaces/${encodeURIComponent(spaceId)}`,
      { method: "PUT", body: JSON.stringify({ accounts }) },
    ),
  decide: (id: string, decision: AppRequestDecision) =>
    apiRequest<{ request: AppRequest }>(requestPath(id), {
      method: "POST",
      body: JSON.stringify({ decision }),
    }),
};
