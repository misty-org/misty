import type { UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { currentApiBase, mistyCloudServer, mistyWebsite } from "@/api/deployment/server_choice";
import { invoke } from "@/native/invoke";
import { hasTauriInternals } from "@/shared/platform/tauri";

export interface DirectCatalogApp {
  name: string;
  description: string;
  url: string;
  app: string;
  icon: string;
  checked: boolean;
}

export interface DirectConnection {
  id: string;
  app: string;
  name: string;
  url: string;
  created_at: string;
}

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
  catalog: (search: string, offset: number) =>
    call<{ apps: DirectCatalogApp[]; total: number }>("direct_apps_catalog", { search, offset }),
  icon: (url: string) => call<string>("direct_apps_icon", { url }),
  check: (urls: string[]) => call<Record<string, DirectAccess>>("direct_apps_check", { urls }),
  list: () => call<DirectConnection[]>("direct_apps_list"),
  connect: (url: string, name: string) =>
    call<{ url: string }>("direct_apps_connect", { url, name, donePage: connectedPage() }),
  disconnect: (id: string) => call<void>("direct_apps_disconnect", { id }),
};

function connectedPage(): string | null {
  return currentApiBase() === mistyCloudServer() ? `${mistyWebsite()}/connected` : null;
}

export function listenDirectApps(
  onChanged: (outcome: { ok: boolean; message?: string }) => void,
): Promise<UnlistenFn> {
  if (!hasTauriInternals()) return Promise.resolve(() => {});
  return getCurrentWebview().listen<{ ok: boolean; message?: string }>(
    DIRECT_APPS_CHANGED_EVENT,
    (event) => onChanged(event.payload),
  );
}
