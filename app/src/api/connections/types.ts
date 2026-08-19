import type { IntegrationCapability } from "@/shared/integrations/types";

export type AccountConnectionStatus = "active" | "needs_attention" | "revoked";

/** One provider account connected privately to the active Misty account. */
export interface AccountConnection {
  id: string;
  provider: string;
  account_display: string;
  account_id?: string;
  account_email?: string;
  status: AccountConnectionStatus;
  capabilities?: IntegrationCapability[];
  granted_scopes?: string[];
  created_at?: string;
  updated_at?: string;
}

export interface AccountConnectionsResponse {
  connections: AccountConnection[];
}

export interface AccountConnectionAuthorizationStart {
  provider: string;
  authorization_url: string;
  state_expires_at?: string;
}
