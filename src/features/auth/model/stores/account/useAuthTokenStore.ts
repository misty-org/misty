export interface SavedAccountSession {
  id: string;
  name: string;
  username?: string;
  email: string;
  accountCreatedAt?: string;
  currentPlan?: string;
  lastUsedAt: string;
}

export interface SecureAccountSession {
  account: SavedAccountSession;
  /** Non-secret cookie-session:<account-id> handle. JWTs remain in native storage. */
  token: string;
  deploymentScope?: string;
}

export interface SecureAccountVault {
  version: 1;
  activeAccountId: string;
  sessions: SecureAccountSession[];
}
