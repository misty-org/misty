import type { SpacesSnapshot } from "./core";
import type { SpaceStorageUsage, StorageQuotaDimension } from "./library";

/**
 * The account's weekly hosted-AI allowance — the budget behind "This member has
 * used all of their weekly AI agent usage". It is per account, not per Space.
 */
export interface AgentUsage {
  /** 0–100. The server sends a percentage, not a ratio. */
  percentage_used: number;
  unit?: "weighted_tokens" | "microusd";
  used?: number;
  reserved?: number;
  limit?: number;
  remaining?: number;
  available: boolean;
  paused: boolean;
  /** When the weekly allowance renews. */
  reset_at?: string;
  plan?: string;
}

/** Weekly account weighted-token meter. Legacy servers may omit the accounting unit. */
export interface AiQuotaUsage {
  percentage_used?: number;
  default_command_limit?: number;
  background_command_limit?: number;
  policy_version?: string;
  unit?: "weighted_tokens" | "microusd";
  used: number;
  reserved: number;
  limit: number;
  /** Available weighted tokens after in-flight reservations. */
  remaining: number;
  /** 0–1. */
  used_ratio: number;
  available: boolean;
  paused: boolean;
  reset_at?: string;
}

export interface BillingEntitlements {
  plan?: string;
  max_owned_spaces?: number;
  personal_storage_limit_bytes?: number;
  space_storage_limit_bytes?: number;
  personal_ai_limit?: number;
  /** Compatibility fields from older servers. */
  space_limit?: number;
  storage_limit_bytes?: number;
  unlimited_spaces?: boolean;
  unlimited_collaborators?: boolean;
}

export interface BillingSpaceUsage {
  space_id: string;
  name: string;
  role: "owner" | "member" | string;
  owner_user_id: string;
  storage?: SpaceStorageUsage;
}

export interface TransferQuotaUsage {
  used: number;
  reserved: number;
  limit: number;
  remaining: number;
  percentage_used: number;
  reset_at?: string;
  policy_version?: string;
}

export interface BillingUsage {
  account?: {
    ai?: AiQuotaUsage;
    cloud_storage?: StorageQuotaDimension;
    storage?: StorageQuotaDimension;
    sync?: TransferQuotaUsage;
  };
  plan?: string;
  entitlements?: BillingEntitlements;
  personal?: {
    storage?: StorageQuotaDimension;
    ai?: AiQuotaUsage;
  };
  spaces?: BillingSpaceUsage[];
  /** Compatibility fields from older servers. */
  agent_usage?: AgentUsage;
  storage?: SpacesSnapshot["owner_storage"];
}
