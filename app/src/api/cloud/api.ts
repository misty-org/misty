import { apiRequest } from "@/api/client";

export type CloudProvider = "drive" | "dropbox" | "onedrive";

export interface CloudConnection {
  id: string;
  provider: CloudProvider;
  name: string;
  account_id: string;
  account_display: string;
  uses_custom_oauth_client: boolean;
  expires_at: string | null;
  connected_account_id?: string;
  connection_source?: "connected_account" | "legacy_cloud";
  status?: "active" | "needs_attention" | "revoked";
  last_error_code?: string;
}

export interface CloudConnectionsSnapshot {
  connections: CloudConnection[];
  limit: { used: number; maximum: number | null };
}

export interface CloudCredentialHandoff {
  connection_id: string;
  provider: CloudProvider;
  handoff: string;
  redeem_url: string;
  expires_at: string;
}

export function cloudConnectionsSnapshot(): Promise<CloudConnectionsSnapshot> {
  return apiRequest("/cloud/connections");
}

export function beginCloudAuthorization(request: {
  provider: CloudProvider;
  name: string;
  clientId?: string;
  clientSecret?: string;
}): Promise<{ authorization_url: string; state_expires_at: string }> {
  return apiRequest(`/cloud/connections/${encodeURIComponent(request.provider)}/authorize`, {
    method: "POST",
    body: JSON.stringify({
      name: request.name,
      clientID: request.clientId?.trim() ?? "",
      clientSecret: request.clientSecret?.trim() ?? "",
      returnTo: "/files",
    }),
  });
}

export function cloudConnectionHandoff(connectionId: string): Promise<CloudCredentialHandoff> {
  return apiRequest(`/cloud/connections/${encodeURIComponent(connectionId)}/handoff`, {
    method: "POST",
  });
}

export function bindCloudConnection(request: {
  connectionId: string;
  name: string;
}): Promise<CloudConnection> {
  return apiRequest("/cloud/connections/bind", {
    method: "POST",
    body: JSON.stringify({ connection_id: request.connectionId, name: request.name }),
  });
}

export function deleteCloudConnection(connectionId: string): Promise<void> {
  return apiRequest(`/cloud/connections/${encodeURIComponent(connectionId)}`, {
    method: "DELETE",
  });
}
