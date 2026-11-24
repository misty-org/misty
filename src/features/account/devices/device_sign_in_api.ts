import { apiRequest } from "@/api/client/request";
import { refreshCachedResource } from "@/api/cache/cached_resource";

export interface AccountSession {
  id: string;
  name: string;
  created_at: string;
  last_used_at?: string | null;
  current: boolean;
}

export interface DeviceSignInRequest {
  name: string;
  created_at: string;
  expires_at: string;
}

export const sessionsKey = (accountId: string) => `account/sessions/${accountId}`;

const sessions = () =>
  apiRequest<{ sessions?: AccountSession[] }>("/me/sessions").then(
    (result) => result.sessions ?? [],
  );

export const deviceSignInApi = {
  sessions,
  signOutSession: (sessionId: string) =>
    apiRequest(`/me/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" }),
  lookup: (code: string) =>
    apiRequest<DeviceSignInRequest>(`/auth/device/lookup?code=${encodeURIComponent(code)}`),
  approve: (code: string) =>
    apiRequest("/auth/device/approve", {
      method: "POST",
      body: JSON.stringify({ user_code: code }),
    }),
  refuse: (code: string) =>
    apiRequest("/auth/device/refuse", {
      method: "POST",
      body: JSON.stringify({ user_code: code }),
    }),
};

export function refreshSessions(accountId: string): Promise<AccountSession[]> {
  return refreshCachedResource(sessionsKey(accountId), sessions, "account");
}
