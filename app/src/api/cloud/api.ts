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
}

export interface CloudConnectionsSnapshot {
  connections: CloudConnection[];
  limit: { used: number; maximum: number | null };
}

export interface CloudTokenLease {
  connection_id: string;
  provider: CloudProvider;
  access_token: string;
  token_type: string;
  expires_at: string | null;
  api_base: string;
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

export function cloudConnectionToken(connectionId: string): Promise<CloudTokenLease> {
  return apiRequest(`/cloud/connections/${encodeURIComponent(connectionId)}/token`, {
    method: "POST",
  });
}

export function deleteCloudConnection(connectionId: string): Promise<void> {
  return apiRequest(`/cloud/connections/${encodeURIComponent(connectionId)}`, {
    method: "DELETE",
  });
}
