export type CurrentUser = {
  id: string;
  name: string;
  email: string;
};

export type CurrentLicense = {
  tier: "basic" | "personal" | "pro";
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

export type InstallerStatus = {
  os: string;
  arch: string;
  misty_home: string;
  install_dir: string;
  legacy_install_dir: string;
  db_path: string;
  current_user: CurrentUser | null;
  current_license: CurrentLicense | null;
  ready: boolean;
  folders: InstallCheck[];
  binaries: InstallCheck[];
  setup_update: InstallCheck;
};

export type CheckStatus = "ready" | "missing" | "pending" | "info";

export type InstallCheck = {
  name: string;
  path: string;
  required: boolean;
  exists: boolean;
  status: CheckStatus;
  message: string;
};

export type NativeSystemInfo = {
  os: string;
  arch: string;
  misty_home: string;
  install_dir: string;
  legacy_install_dir: string;
  db_path: string;
  setup_path: string;
  current_user: CurrentUser | null;
  current_license: CurrentLicense | null;
};

export type PathProbe = {
  path: string;
  exists: boolean;
  is_dir: boolean;
  is_file: boolean;
};

export type InstallEvent = {
  level: "info" | "warn" | "error";
  source: "installer" | "launcher";
  message: string;
};

export type InstallState = "idle" | "installing" | "success" | "error";

export type ReleaseVersion = {
  version: string;
  date: string;
  summary: string;
  manifestUrl: string;
  changes: string[];
};
