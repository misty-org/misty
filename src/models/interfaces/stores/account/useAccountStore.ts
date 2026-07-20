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

export interface BillingUsageResponse {
  plan: "basic" | "pro" | "max";
  monthly_allowance: number;
  monthly_remaining: number;
  purchased_remaining: number;
  available_credits: number;
  reserved_credits: number;
  next_reset_at: string;
  usage_by_meter: Array<{ meter: string; credits: number }> | null;
}

export interface LoginResponse {
  id?: string;
  user_id?: string;
  token?: string;
  name: string;
  username: string;
  email: string;
}
