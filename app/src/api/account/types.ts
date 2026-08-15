export interface AccountAuthUser {
  id: string;
  name: string;
  username: string;
  email: string;
}

export interface AccountMeResponse {
  id: string;
  name: string;
  username: string;
  email: string;
  avatar_version?: number;
  created_at: string;
  tier: "basic" | "pro" | "max";
  status: "active" | "trialing" | "cancelled" | "expired";
  allows_use: boolean;
  expires_at: string | null;
  trial_started_at: string | null;
  license_device: string;
  billing?: {
    kind: "free" | "trial" | "lifetime" | "subscription";
    interval: "month" | "year" | null;
    subscription_status: string | null;
    current_period_end: string | null;
    cancel_at_period_end: boolean;
    customer_portal_available: boolean;
  };
}

/** Account surfaces that the server permits a desktop handoff to open. */
export type AccountHandoffPath =
  "/settings" | "/settings/account" | "/settings/usage" | "/settings/billing" | "/settings/privacy";

export interface LoginResponse {
  id?: string;
  user_id?: string;
  token?: string;
  name: string;
  username: string;
  email: string;
}
