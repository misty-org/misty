export interface SavedAccountSession {
  id: string;
  username: string;
  email: string;
  accountCreatedAt?: string;
  lastUsedAt: string;
}

export interface SecureAccountSession {
  account: SavedAccountSession;
  /** Non-secret cookie-session:<account-id> handle. JWTs remain in native storage. */
  token: string;
}

export interface SecureAccountVault {
  version: 1;
  activeAccountId: string;
  sessions: SecureAccountSession[];
}

/** The prefix of the active account's id in the vault, kept from when one device held sessions
 * for several servers. */
const vaultScope = "hosted";

/** Reads the vault. Sessions an older release saved for a different server are dropped. */
export function parseSecureVault(raw: string | null): SecureAccountVault {
  if (raw) {
    try {
      const value = JSON.parse(raw) as Partial<SecureAccountVault>;
      if (value.version === 1 && Array.isArray(value.sessions)) {
        const sessions = value.sessions
          .map(secureAccountSession)
          .filter(isPresent)
          .filter((session) => session.token.startsWith("cookie-session:"));
        return { version: 1, activeAccountId: String(value.activeAccountId ?? ""), sessions };
      }
    } catch {
      // Anything else in the keystore is not a vault: the person signs in again.
    }
  }
  return emptyVault();
}
function usernameFromEmail(email: string): string {
  return email.split("@")[0] ?? email;
}
export const isPresent = <T>(value: T | null): value is T => value !== null;
/** Accounts saved before usernames replaced display names carry a `name` and no username. */
export function savedAccountSession(value: unknown): SavedAccountSession | null {
  if (!value || typeof value !== "object") return null;
  const { name: _name, ...item } = value as Partial<SavedAccountSession> & { name?: unknown };
  if (!item.id || !item.email || !item.lastUsedAt) return null;
  return {
    ...item,
    username: item.username || usernameFromEmail(item.email),
  } as SavedAccountSession;
}
function secureAccountSession(value: unknown): SecureAccountSession | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<SecureAccountSession> & { deploymentScope?: unknown };
  const account = savedAccountSession(item.account);
  if (typeof item.token !== "string" || item.token.length === 0 || !account) return null;
  // Saved for another server by a release that kept several.
  if (item.deploymentScope !== undefined && item.deploymentScope !== vaultScope) return null;
  return { account, token: item.token };
}
export function vaultAccountId(accountId: string): string {
  return `${vaultScope}:${accountId}`;
}
export function activeVaultAccountId(vault: SecureAccountVault): string {
  const prefix = `${vaultScope}:`;
  if (vault.activeAccountId.startsWith(prefix)) return vault.activeAccountId.slice(prefix.length);
  // Vaults written before deployment namespacing contain a bare Hosted id.
  return vault.activeAccountId.includes(":") ? "" : vault.activeAccountId;
}
function emptyVault(): SecureAccountVault {
  return {
    version: 1,
    activeAccountId: "",
    sessions: [],
  };
}
