import { localAppsApi } from "./local_api";

export interface AppRequest {
  id: string;
  kind: "connect" | "approve";
  subject: string;
  title: string;
  summary: string;
  state: "pending" | "connected" | "approved" | "used" | "declined" | "expired";
  expiresAt: string;
  rememberable?: boolean;
  rememberLabel?: string;
  permissionMode?: "ask" | "auto";
  paymentCap?: { max_amount_minor: number; currency: string };
}

export type AppRequestDecision = "continue" | "remember" | "deny";

export const appsApi = {
  request: (id: string) => localAppsApi.request(id),
  decide: (id: string, decision: AppRequestDecision) => localAppsApi.decide(id, decision),
};
