import { apiBase } from "../../lib/apiBase";
import type { BillingInterval, PaidTier } from "@/pages/Pricing/data";

export interface MeResponse {
  id: string;
  name: string;
  email: string;
  created_at: string;
  tier: "basic" | "pro" | "max";
  status: "active" | "trialing" | "cancelled" | "expired";
  allows_use: boolean;
  expires_at: string | null;
  trial_started_at: string | null;
  /** Server-authoritative eligibility for the one-time Pro trial. */
  trial_eligible?: boolean;
  license_device: string;
  /** Bumped by the server on every avatar upload; used to bust the image cache. */
  avatar_version?: number;
  billing?: {
    // "lifetime" covers historical purchases the server still reports.
    kind: "free" | "trial" | "subscription" | "lifetime";
    interval: "month" | "year" | null;
    subscription_status: string | null;
    current_period_end: string | null;
    cancel_at_period_end: boolean;
    customer_portal_available: boolean;
  };
}

export interface BillingUsageResponse {
  plan: "basic" | "pro" | "max";
  storage: {
    used_bytes: number;
    reserved_bytes: number;
    limit_bytes: number;
    remaining_bytes: number;
    over_quota: boolean;
    over_quota_since?: string;
    cleanup_notice_until?: string;
  };
  /** The current field. Prefer this over the deprecated `hosted_ai` mirror. */
  agent_usage?: {
    percentage_used: number;
    reset_at: string | null;
  };
  /**
   * @deprecated The server labels this "retained for existing clients during
   * the response-field migration"; `agent_usage` replaces it.
   */
  hosted_ai?: {
    used_ratio: number;
    reset_at: string | null;
  };
  // These dates are genuinely nullable on the server (`*time.Time`), so every
  // read has to guard before constructing a Date.
  trial?: { status: string; ends_at: string | null };
  subscription?: {
    status: string;
    current_period_end: string | null;
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

export interface AccountSettingsResponse {
  email_updates_enabled: boolean;
  analytics_enabled: boolean;
  error_reporting_enabled: boolean;
}

export async function fetchAccountSettings(): Promise<AccountSettingsResponse> {
  const res = await apiFetch("/me/settings");
  return res.json();
}

/**
 * The server decodes this body into plain booleans with no pointers, so an
 * omitted key is written as `false`. Every call must therefore send all three,
 * never a partial patch.
 */
export async function updateAccountSettings(
  settings: AccountSettingsResponse,
): Promise<void> {
  await apiFetch("/me/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email_updates_enabled: settings.email_updates_enabled,
      analytics_enabled: settings.analytics_enabled,
      error_reporting_enabled: settings.error_reporting_enabled,
    }),
  });
}

/** The avatar endpoint takes a raw PNG body — not multipart. */
export async function uploadAvatar(png: Blob): Promise<void> {
  await apiFetch("/me/avatar", {
    method: "PUT",
    headers: { "Content-Type": "image/png" },
    body: png,
  });
}

export function avatarUrl(version: number | undefined): string {
  return `${apiBase}/me/avatar?v=${version ?? 0}`;
}

export interface AccountExportManifest {
  account_data: Record<string, unknown>;
  documents: {
    kind: "note" | "drawing";
    id: string;
    space_id: string;
    title: string;
    acl_version: number;
    created_at: string;
    updated_at: string;
    // Signed and short-lived; stripped from the copy written into the archive.
    download_url: string;
    expires_at: string;
  }[];
  assets: {
    kind: "note" | "drawing" | "library" | "message_attachment";
    id: string;
    parent_id: string;
    filename: string;
    mime_type: string;
    byte_size: number;
    sha256: string;
    created_at: string;
    download: {
      url: string;
      expires_at: string;
      filename: string;
      mime_type: string;
      byte_size: number;
      sha256: string;
    };
  }[];
}

export async function requestExportManifest(
  password: string,
): Promise<AccountExportManifest> {
  const res = await apiFetch("/me/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  return res.json();
}

export interface AccountDeletionResponse {
  status?: string;
  scheduled_purge_at?: string;
  status_token?: string;
  /** Present on a 409: Spaces the account owns must be handed over first. */
  spaces?: { id: string; name: string }[];
}

export class AccountDeletionBlockedError extends Error {
  constructor(readonly spaces: { id: string; name: string }[]) {
    super("Hand over or delete the Spaces you own before deleting the account.");
    this.name = "AccountDeletionBlockedError";
  }
}

export async function beginAccountDeletion(
  password: string,
  confirmation: string,
): Promise<AccountDeletionResponse> {
  // Not apiFetch: a 409 carries a JSON blocker list that must survive, and
  // apiFetch collapses every non-2xx into a text Error.
  const res = await fetch(`${apiBase}/me/deletion`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password, confirmation }),
  });

  if (res.status === 409) {
    const blocked = (await res.json().catch(() => ({}))) as {
      spaces?: { id: string; name: string }[];
    };
    throw new AccountDeletionBlockedError(blocked.spaces ?? []);
  }
  if (!res.ok) {
    const text = await res.text();
    throw Object.assign(new Error(text.trim() || "Request failed"), {
      status: res.status,
    });
  }
  return res.json();
}
