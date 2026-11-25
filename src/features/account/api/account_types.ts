import type { AvatarDecoration } from "@/shared/lib/avatar_decoration";

export interface AccountAuthUser {
  provider?: "misty" | "google";
  id: string;
  username: string;
  email: string;
}

export interface AccountMeResponse {
  provider?: "misty" | "google";
  id: string;
  username: string;
  email: string;
  avatar_version?: number;
  avatar_decoration?: AvatarDecoration;
  banner_version?: number;
  created_at: string;
  delete_at?: string | null;
  server_owner?: boolean;
}

export interface ServerAlert {
  probe: string;
  title: string;
  detail: string;
  opened_at: string;
}

export interface LoginResponse {
  provider?: "misty" | "google";
  id?: string;
  user_id?: string;
  username: string;
  email: string;
}

export interface SetupKeyResponse extends LoginResponse {
  password_reset_token?: string;
}
