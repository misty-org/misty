export interface AccountAuthUser {
  provider?: "misty" | "google";
  id: string;
  username: string;
  email: string;
}

export interface AccountMeResponse {
  /** The server's record that it has only ever seen a derived credential, never the password. */
  credential_account?: boolean;
  provider?: "misty" | "google";
  id: string;
  username: string;
  email: string;
  avatar_version?: number;
  created_at: string;
  /** AI needs a confirmed email; older servers omit the field. */
  email_verified?: boolean;
}

/** Account surfaces that the server permits a desktop handoff to open. */
export type AccountHandoffPath = "/settings" | "/settings/account" | "/settings/privacy";

export interface LoginResponse {
  /** The server's record that it has only ever seen a derived credential, never the password. */
  credential_account?: boolean;
  provider?: "misty" | "google";
  id?: string;
  user_id?: string;
  username: string;
  email: string;
}
