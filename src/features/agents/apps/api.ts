import { localAppsApi } from "./localApi";

/** An app account connected once; agents use it in every Space. */
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

/**
 * What an agent needs from the user to continue: connect an app or approve one action.
 */
export interface AppRequest {
  id: string;
  kind: "connect" | "approve";
  subject: string;
  title: string;
  summary: string;
  state: "pending" | "connected" | "approved" | "used" | "declined" | "expired";
  expiresAt: string;
  /** "Accept and remember" is offered; the label names the exact scope. */
  rememberable?: boolean;
  rememberLabel?: string;
  /** The run's Ask or Auto when it paused. */
  permissionMode?: "ask" | "auto";
  /** A remembered payment covers this merchant up to this amount per payment. */
  paymentCap?: { max_amount_minor: number; currency: string };
}

/** The answer to an approval card: this time only, this time and from now on, or no. */
export type AppRequestDecision = "continue" | "remember" | "deny";

/** Connected apps run on this computer's Composio key. */
export const appsApi = {
  list: (_onCached?: (value: { available: boolean; apps: ConnectedApp[] }) => void) =>
    localAppsApi.list(),
  catalog: (
    search: string,
    cursor = "",
    _onCached?: (value: { apps: CatalogApp[]; next_cursor: string }) => void,
  ) => localAppsApi.catalog(search, cursor),
  connect: (app: string) => localAppsApi.connect(app),
  disconnect: (id: string) => localAppsApi.disconnect(id),
  request: (id: string) => localAppsApi.request(id),
  requestLink: (id: string) => localAppsApi.requestLink(id),
  decide: (id: string, decision: AppRequestDecision) => localAppsApi.decide(id, decision),
};
