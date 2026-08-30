import { apiRequest } from "@/api/client";
import type { IntegrationCapability } from "@/shared/integrations/types";
import type { AccountConnectionAuthorizationStart, AccountConnectionsResponse } from "./types";

const part = encodeURIComponent;

/** Account-level provider connections. Tokens never enter the renderer. */
export const connectionsApi = {
  list: () => apiRequest<AccountConnectionsResponse>("/connections"),
  authorize: (provider: string, capabilities: IntegrationCapability[], returnTo = "/inbox") =>
    apiRequest<AccountConnectionAuthorizationStart>(`/connections/${part(provider)}/authorize`, {
      method: "POST",
      body: JSON.stringify({ capabilities, return_to: returnTo }),
    }),
  remove: (connectionId: string) =>
    apiRequest<void>(`/connections/${part(connectionId)}`, { method: "DELETE" }),
};
