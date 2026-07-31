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
  tier: "basic" | "pro";
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
  trial?: { status: string; ends_at: string | null };
  subscription?: {
    status: string;
    current_period_end: string | null;
    cancel_at_period_end: boolean;
    billing_interval: "month" | "year";
  };
}

export interface LoginResponse {
  id?: string;
  user_id?: string;
  token?: string;
  name: string;
  username: string;
  email: string;
}

export interface AccountDeletionResponse {
  request: {
    id: string;
    status: "processing" | "scheduled" | "completed" | "failed";
    purge_after: string;
    created_at: string;
    updated_at: string;
  };
  status_token: string;
}

export interface AccountExportManifest {
  account_data: Record<string, unknown>;
  documents: Array<{
    kind: "note" | "drawing";
    id: string;
    space_id: string;
    title: string;
    acl_version: number;
    created_at: string;
    updated_at: string;
    download_url: string;
    expires_at: string;
  }>;
  assets: Array<{
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
  }>;
}
