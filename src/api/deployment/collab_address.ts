import { nativeAccountFetch } from "@/api/client/native_account_fetch";
import { hasTauriInternals } from "@/shared/platform/tauri";

const ADDRESS_BOUND_MS = 10_000;
const ROOM_SCHEMES = new Set(["https:", "http:", "wss:", "ws:"]);

const known = new Map<string, string>();
const asking = new Map<string, Promise<string>>();

function addressIn(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const said = (value as { collab_url?: unknown }).collab_url;
  if (typeof said !== "string" || !said.trim()) return null;
  try {
    const url = new URL(said.trim());
    if (!ROOM_SCHEMES.has(url.protocol) || url.username || url.password) return null;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

async function ask(apiBase: string): Promise<string> {
  const url = `${apiBase}/health`;
  const init: RequestInit = { method: "GET", signal: AbortSignal.timeout(ADDRESS_BOUND_MS) };
  const response = hasTauriInternals()
    ? await nativeAccountFetch(url, init)
    : await fetch(url, init);
  const said: unknown = await response.json();
  return addressIn(said) ?? apiBase;
}

export function collabAddress(apiBase: string): Promise<string> {
  const base = apiBase.replace(/\/+$/, "");
  const found = known.get(base);
  if (found) return Promise.resolve(found);
  const pending = asking.get(base);
  if (pending) return pending;
  const next = ask(base)
    .then(
      (address) => {
        known.set(base, address);
        return address;
      },
      () => base,
    )
    .finally(() => asking.delete(base));
  asking.set(base, next);
  return next;
}
