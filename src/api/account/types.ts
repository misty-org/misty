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
  /** When a closing account is deleted (RFC 3339); null while it isn't closing. It is read-only until then. */
  delete_at?: string | null;
  /** The server's first account, which sees the alerts service's open problems. */
  server_owner?: boolean;
}

/** A problem the server's alerts service saw twice in a row and that has not cleared. */
export interface ServerAlert {
  probe: string;
  title: string;
  detail: string;
  opened_at: string;
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

export interface SetupKeyResponse extends LoginResponse {
  /** Lets this sign-in choose a new password without the old one, for a short while. */
  password_reset_token?: string;
}
