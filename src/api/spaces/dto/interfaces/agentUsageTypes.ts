import type { SpacesSnapshot } from "./core";
import type { SpaceStorageUsage, StorageQuotaDimension } from "./library";

/**
 * The account's weekly hosted-AI allowance — the budget behind "This member has
 * used all of their weekly AI agent usage". It is per account, not per Space.
 */
export interface AgentUsage {
  /** 0–100. The server sends a percentage, not a ratio. */
  percentage_used: number;
  available: boolean;
  paused: boolean;
  /** When the weekly allowance renews. */
  reset_at?: string;
  plan?: string;
}

/** A customer-facing usage meter. Values are intentionally unit-agnostic. */
export interface AiQuotaUsage {
  used: number;
  reserved: number;
  limit: number;
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
  space_ai_limit?: number;
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
  ai?: AiQuotaUsage;
}

export interface BillingUsage {
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

export function quotaPercentUsed(usage: AiQuotaUsage | AgentUsage | undefined): number {
  if (!usage) return 0;
  if ("used_ratio" in usage) return Math.max(0, Math.min(100, usage.used_ratio * 100));
  return Math.max(0, Math.min(100, usage.percentage_used));
}

export function personalAgentUsage(result: BillingUsage | null): AgentUsage | null {
  const personal = result?.personal?.ai;
  if (personal) {
    return {
      percentage_used: quotaPercentUsed(personal),
      available: personal.available,
      paused: personal.paused,
      reset_at: personal.reset_at,
      plan: result?.plan,
    };
  }
  return result?.agent_usage ?? null;
}
