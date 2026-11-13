import type { UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { currentApiBase, mistyCloudServer, mistyWebsite } from "@/api/deployment/serverChoice";
import { invoke } from "@/native/invoke";
import { hasTauriInternals } from "@/shared/platform/tauri";

/**
 * Apps connected directly: the person signs in to the app's own MCP server, run by its maker, and
 * native code keeps the tokens in the keychain. This side sees which apps are connected, never a
 * token.
 */

/** An app a person can connect. `app` is the short name its tools are filed under. */
export interface DirectCatalogApp {
  name: string;
  description: string;
  url: string;
  app: string;
  /** The maker's own logo, fetched only through native code; empty when none was found. */
  icon: string;
  /** Its sign-in was found keyless when this build's catalog was made. */
  checked: boolean;
}

export interface DirectConnection {
  id: string;
  app: string;
  name: string;
  url: string;
  created_at: string;
}

/** What signing in to a server takes. Only `keyless` is offered. */
export type DirectAccess = "keyless" | "open" | "needs_app" | "unreachable";

const DIRECT_APPS_CHANGED_EVENT = "direct-apps://changed";

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (cause) {
    if (cause instanceof Error) throw cause;
    const message = (cause as { message?: unknown } | null)?.message;
    throw new Error(typeof message === "string" ? message : "That didn’t go through. Try again.");
  }
}

export const directAppsApi = {
  /** One page of apps matching `search`; `total` counts the shipped catalog's matches. */
  catalog: (search: string, offset: number) =>
    call<{ apps: DirectCatalogApp[]; total: number }>("direct_apps_catalog", { search, offset }),
  /** A maker's logo as a data address, kept on this computer once fetched. */
  icon: (url: string) => call<string>("direct_apps_icon", { url }),
  check: (urls: string[]) => call<Record<string, DirectAccess>>("direct_apps_check", { urls }),
  list: () => call<DirectConnection[]>("direct_apps_list"),
  /** Starts a sign-in and returns the address to open; the end arrives as a changed event. */
  connect: (url: string, name: string) =>
    call<{ url: string }>("direct_apps_connect", { url, name, donePage: connectedPage() }),
  disconnect: (id: string) => call<void>("direct_apps_disconnect", { id }),
};

/**
 * Where the browser tab goes once a sign-in's code is back, so it doesn't end on the one-time local
 * address: Misty's website, only for someone who chose Misty Cloud. Anyone else keeps the local page.
 */
function connectedPage(): string | null {
  return currentApiBase() === mistyCloudServer() ? `${mistyWebsite()}/connected` : null;
}

/** A sign-in begun in this window ended, well or not. */
export function listenDirectApps(
  onChanged: (outcome: { ok: boolean; message?: string }) => void,
): Promise<UnlistenFn> {
  if (!hasTauriInternals()) return Promise.resolve(() => {});
  // Native code sends it to the window the sign-in began in.
  return getCurrentWebview().listen<{ ok: boolean; message?: string }>(
    DIRECT_APPS_CHANGED_EVENT,
    (event) => onChanged(event.payload),
  );
}
