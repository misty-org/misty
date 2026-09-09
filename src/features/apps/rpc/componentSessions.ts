import type {
  MistyComponentDefinition,
  MistyComponentLibraries,
  MistyComponentSession,
} from "@misty/sdk";
import { AppRpcError } from "./session";
import { accountScopeResetEvent } from "@/features/auth/runtimeSession";

/** These fields come from the host's verified catalog/session, never an app request. */
export function componentSessionKey(identity: {
  appId: string;
  accountId: string;
  spaceId: string;
  serverBase: string;
  packageHash: string;
  scopes: readonly string[];
}) {
  return JSON.stringify([
    identity.appId,
    identity.accountId,
    identity.spaceId,
    new URL(identity.serverBase).href.replace(/\/$/, ""),
    identity.packageHash,
    [...new Set(identity.scopes)].sort(),
  ]);
}
interface Entry {
  definition: MistyComponentDefinition;
  controller: AbortController;
  clients: Map<symbol, () => void>;
  promise: Promise<MistyComponentSession>;
  session?: MistyComponentSession;
  timer?: ReturnType<typeof setTimeout>;
  closed: boolean;
  disposing?: Promise<void>;
}
/** State belongs to a verified app/deployment/account/Space/package/grant scope.
 * Native resource and SDK authority lifetimes remain attached to individual views. */
export function createComponentSessionRegistry(options: { idleMs?: number; limit?: number } = {}) {
  const entries = new Map<string, Entry>();
  const idleMs = options.idleMs ?? 60_000,
    limit = options.limit ?? 64;
  const dispose = (entry: Entry, session: MistyComponentSession) =>
    (entry.disposing ??= Promise.resolve().then(() => session.close()));
  const close = (key: string, entry: Entry) => {
    if (entry.closed) return entry.disposing ?? Promise.resolve();
    entry.closed = true;
    if (entries.get(key) === entry) entries.delete(key);
    if (entry.timer !== undefined) clearTimeout(entry.timer);
    const callbacks = [...entry.clients.values()];
    entry.clients.clear();
    callbacks.forEach((invalidate) => {
      try {
        invalidate();
      } catch {
        /* Continue invalidating peers. */
      }
    });
    entry.controller.abort();
    return entry.session ? dispose(entry, entry.session) : Promise.resolve();
  };
  return {
    acquire(
      key: string,
      definition: MistyComponentDefinition,
      libraries: MistyComponentLibraries,
      invalidate: () => void,
    ) {
      if (!key || key.length > 16384 || !definition.createSession)
        throw new AppRpcError("invalid_component", "The App needs a valid host session identity.");
      let entry = entries.get(key);
      if (entry && entry.definition !== definition)
        throw new AppRpcError("invalid_component", "The App session's package identity changed.");
      if (!entry) {
        if (entries.size >= limit) {
          const idle = [...entries].find(([, value]) => value.clients.size === 0);
          if (idle) void close(...idle).catch(() => undefined);
        }
        if (entries.size >= limit)
          throw new AppRpcError("resource_limit", "Too many active App sessions.");
        const controller = new AbortController();
        const created: Entry = {
          definition,
          controller,
          clients: new Map(),
          closed: false,
          promise: undefined as never,
        };
        entry = created;
        entries.set(key, created);
        created.promise = Promise.resolve()
          .then(() => definition.createSession!({ signal: controller.signal, libraries }))
          .then(async (session) => {
            if (
              !session ||
              typeof session.mount !== "function" ||
              typeof session.close !== "function"
            )
              throw new AppRpcError(
                "invalid_component",
                "The App did not return a shared session lifecycle.",
              );
            created.session = session;
            if (created.closed) {
              await dispose(created, session).catch(() => undefined);
              throw new AppRpcError("app_closed", "The App session closed while starting.");
            }
            return session;
          })
          .catch((error) => {
            void close(key, created).catch(() => undefined);
            throw error;
          });
      }
      if (entry.timer !== undefined) {
        clearTimeout(entry.timer);
        entry.timer = undefined;
      }
      const client = Symbol();
      entry.clients.set(client, invalidate);
      let released = false;
      const owned = entry;
      return {
        ready: owned.promise,
        release() {
          if (released) return;
          released = true;
          owned.clients.delete(client);
          if (!owned.closed && owned.clients.size === 0)
            owned.timer = setTimeout(() => {
              void close(key, owned).catch(() => undefined);
            }, idleMs);
        },
      };
    },
    async closeAll() {
      await Promise.allSettled([...entries].map(([key, entry]) => close(key, entry)));
    },
    size: () => entries.size,
  };
}
export const componentSessions = createComponentSessionRegistry();
// Keep reset handling alive while sessions are idle and no view is mounted.
if (typeof window !== "undefined") {
  const reset = () => {
    void componentSessions.closeAll();
  };
  window.addEventListener(accountScopeResetEvent, reset);
  import.meta.hot?.dispose(() => {
    window.removeEventListener(accountScopeResetEvent, reset);
    void componentSessions.closeAll();
  });
}
