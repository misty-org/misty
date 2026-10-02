export type CurrentUser = {
  id: string;
  name: string;
  username?: string;
  email: string;
};

export type CurrentLicense = {
  tier: "basic" | "pro" | "max";
  status: "active" | "trialing" | "cancelled" | "expired";
  allows_use: boolean;
  expires_at: string | null;
  trial_started_at: string | null;
  license_device: string | null;
  verified_at?: string | null;
  refresh_after?: string | null;
  verified_until?: string | null;
  needs_refresh?: boolean;
  verification_expired?: boolean;
};

/** The account this device last signed in with, as recorded by the native app. */
export type NativeSession = {
  current_user: CurrentUser | null;
  current_license: CurrentLicense | null;
};
