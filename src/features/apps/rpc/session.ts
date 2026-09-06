export interface AppRpcIdentity {
  appId: string;
  accountId: string;
  spaceId?: string;
  instanceId: string;
}

export class AppRpcError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AppRpcError";
  }
}

/** Per-mounted-app permission/lifetime ceiling, also checked after async work. */
export function createAppRpcScope(options: {
  identity: AppRpcIdentity;
  scopes: readonly string[];
  expiresAt: string;
  isCurrentAccount: (accountId: string) => boolean;
}) {
  const identity = Object.freeze({ ...options.identity });
  const ceiling = new Set(options.scopes);
  const abort = new AbortController();
  let failure: AppRpcError | null = null;
  let scopes = new Set(ceiling);
  let expiry = Date.parse(options.expiresAt);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const invalidate = (code: string, message: string) => {
    if (failure) return;
    failure = new AppRpcError(code, message);
    clearTimeout(timer);
    abort.abort(failure);
  };
  const scheduleExpiry = () => {
    clearTimeout(timer);
    const delay = expiry - Date.now();
    if (!Number.isFinite(delay) || delay <= 0) {
      invalidate("session_expired", "The App session expired.");
      return;
    }
    timer = setTimeout(scheduleExpiry, Math.min(delay, 2_147_483_647));
  };
  scheduleExpiry();
  return {
    identity,
    signal: abort.signal,
    assert(capability?: string) {
      if (!failure && !options.isCurrentAccount(identity.accountId))
        invalidate("account_changed", "The active account changed.");
      if (!failure && (!Number.isFinite(expiry) || expiry <= Date.now()))
        invalidate("session_expired", "The App session expired.");
      if (failure) throw failure;
      if (capability && !scopes.has(capability))
        throw new AppRpcError(
          "capability_denied",
          `This App does not have ${capability} permission.`,
        );
    },
    refresh(next: { scopes: readonly string[]; expiresAt: string }) {
      if (failure) throw failure;
      const granted = new Set(next.scopes.filter((scope) => ceiling.has(scope)));
      if ([...scopes].some((scope) => !granted.has(scope))) {
        invalidate(
          "permissions_changed",
          "The App permissions changed. Reopen the App to continue.",
        );
        return;
      }
      scopes = granted;
      expiry = Date.parse(next.expiresAt);
      scheduleExpiry();
    },
    close() {
      invalidate("app_closed", "The App has closed.");
    },
  };
}

export type AppRpcScope = ReturnType<typeof createAppRpcScope>;

export function rpcRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AppRpcError("invalid_params", "Expected an App method parameter object.");
  return value as Record<string, unknown>;
}
export function rpcString(value: unknown, maximum = 4096, empty = false): string {
  if (
    typeof value !== "string" ||
    (!empty && !value.length) ||
    value.length > maximum ||
    value.includes("\0")
  )
    throw new AppRpcError("invalid_params", "Invalid App string parameter.");
  return value;
}
export function rpcInteger(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum)
    throw new AppRpcError("invalid_params", "Invalid App integer parameter.");
  return value;
}
