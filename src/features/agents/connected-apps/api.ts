import { localAppsApi } from "./localApi";

/**
 * What an agent needs from the user to continue: approve one action in a connected app.
 * (`connect` cards are from before apps were only connected directly.)
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

/** App action cards, kept on this computer. */
export const appsApi = {
  request: (id: string) => localAppsApi.request(id),
  decide: (id: string, decision: AppRequestDecision) => localAppsApi.decide(id, decision),
};
