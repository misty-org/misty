import { apiBase } from "../../lib/apiBase";
import type { BillingInterval, PaidTier } from "@/lib/pricing";

export interface MeResponse {
  id: string;
  name: string;
  email: string;
  created_at: string;
  tier: "basic" | "pro";
  status: "active" | "trialing" | "cancelled" | "expired";
  allows_use: boolean;
  expires_at: string | null;
  trial_started_at: string | null;
  license_device: string;
  billing?: {
    kind: "free" | "trial" | "subscription";
    interval: "month" | "year" | null;
    subscription_status: string | null;
    current_period_end: string | null;
    cancel_at_period_end: boolean;
    customer_portal_available: boolean;
  };
}

export interface BillingUsageResponse {
  plan: "basic" | "pro";
  storage: {
    used_bytes: number;
    reserved_bytes: number;
    limit_bytes: number;
    remaining_bytes: number;
    over_quota: boolean;
    over_quota_since?: string;
    cleanup_notice_until?: string;
  };
  hosted_ai: {
    used_ratio: number;
    reset_at: string;
  };
  trial?: { status: string; ends_at: string };
  subscription?: {
    status: string;
    current_period_end: string;
    cancel_at_period_end: boolean;
    billing_interval: BillingInterval;
  };
}

async function apiFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${apiBase}${path}`, {
    credentials: "include",
    ...init,
  });
  if (!res.ok) {
    const text = await res.text();
    throw Object.assign(new Error(text.trim() || "Request failed"), {
      status: res.status,
    });
  }
  return res;
}

export async function fetchMe(): Promise<MeResponse> {
  const res = await apiFetch("/me");
  return res.json();
}

export async function fetchBillingUsage(): Promise<BillingUsageResponse> {
  const res = await apiFetch("/billing/usage");
  return res.json();
}

export async function createSubscriptionCheckout(
  tier: PaidTier,
  interval: BillingInterval,
): Promise<{ url: string }> {
  const res = await apiFetch("/billing/checkout-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tier, interval }),
  });
  return res.json();
}

export async function createBillingPortal(): Promise<{ url: string }> {
  const res = await apiFetch("/billing/portal-session", { method: "POST" });
  return res.json();
}

export async function updateProfile(name: string): Promise<void> {
  await apiFetch("/me/profile", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

export async function updateDevice(device: string): Promise<void> {
  await apiFetch("/me/device", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device }),
  });
}

export async function logoutRequest(): Promise<void> {
  await fetch(`${apiBase}/logout`, { method: "POST", credentials: "include" });
}
