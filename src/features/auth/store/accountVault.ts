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
  deploymentScope?: string;
}

export interface SecureAccountVault {
  version: 1;
  activeAccountId: string;
  sessions: SecureAccountSession[];
}

export const hostedScope = "hosted";
const legacyUserKey = "misty_user";

export function parseSecureVault(raw: string | null): {
  vault: SecureAccountVault;
  migrated: boolean;
} {
  if (raw) {
    try {
      const value = JSON.parse(raw) as Partial<SecureAccountVault>;
      if (value.version === 1 && Array.isArray(value.sessions)) {
        const sessions = value.sessions
          .map(secureAccountSession)
          .filter(isPresent)
          .filter((session) => session.token.startsWith("cookie-session:"));
        return {
          vault: {
            version: 1,
            activeAccountId: String(value.activeAccountId ?? ""),
            sessions,
          },
          migrated: false,
        };
      }
    } catch {
      // Existing releases stored the active token directly; migrate it below.
    }
  }
  const legacyAccount = readLegacyAccount();
  if (raw?.startsWith("cookie-session:") && legacyAccount) {
    const account = {
      ...legacyAccount,
      lastUsedAt: new Date().toISOString(),
    };
    return {
      vault: {
        version: 1,
        activeAccountId: vaultAccountId(account.id),
        sessions: [
          {
            account,
            token: raw,
            deploymentScope: hostedScope,
          },
        ],
      },
      migrated: true,
    };
  }
  return {
    vault: emptyVault(),
    migrated: false,
  };
}
function readLegacyAccount(): Omit<SavedAccountSession, "lastUsedAt"> | null {
  try {
    const raw = localStorage.getItem(legacyUserKey);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<SavedAccountSession>;
    if (!value.id || !value.email) return null;
    return {
      id: value.id,
      username: value.username || usernameFromEmail(value.email),
      email: value.email,
      accountCreatedAt: value.accountCreatedAt,
    };
  } catch {
    return null;
  }
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
  const item = value as Partial<SecureAccountSession>;
  const account = savedAccountSession(item.account);
  if (
    typeof item.token !== "string" ||
    item.token.length === 0 ||
    !account ||
    (item.deploymentScope !== undefined && typeof item.deploymentScope !== "string")
  )
    return null;
  return { ...item, account } as SecureAccountSession;
}
/** Misty is hosted only. Sessions saved for a self-hosted server stay in the vault, unused. */
export function isHostedSession(session: SecureAccountSession): boolean {
  return (session.deploymentScope || hostedScope) === hostedScope;
}
export function hostedSessions(vault: SecureAccountVault): SecureAccountSession[] {
  return vault.sessions.filter(isHostedSession);
}
export function vaultAccountId(accountId: string): string {
  return `${hostedScope}:${accountId}`;
}
export function activeHostedAccountId(vault: SecureAccountVault): string {
  const prefix = `${hostedScope}:`;
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
