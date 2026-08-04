import { appSnapshot } from "@/stores/backend";
import { normalizeApiBaseUrl, withDefaultApiPath } from "@/stores/backend";
import { isAndroidBuild, isNativeMobileBuild } from "@/platform/buildTarget";
import {
  clearAccountAuthToken,
  readAccountAuthToken,
  saveAccountAuthToken,
} from "@/stores/account/useAuthTokenStore";
import type { SavedAccountSession } from "@/models/interfaces/stores/account/useAuthTokenStore";
import { analytics } from "@/analytics/client";

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
  // "max" is a real server tier. Omitting it here made Max subscribers read as
  // Pro everywhere the desktop gates on the plan.
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

/**
 * The account surfaces the desktop app can hand off to. The server keeps its
 * own allowlist; this union just stops typos reaching it.
 */
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
