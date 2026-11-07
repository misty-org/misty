import { invoke } from "@/native/invoke";
import type { AgentGrant } from "../grants/api";
import type { AppRequest, AppRequestDecision, CatalogApp, ConnectedApp } from "./api";

/**
 * Connected apps on this computer, on the person's own Composio key.
 * Native code holds the key and calls Composio; this side never sees it. Cards and remembered
 * approvals live in misty.db, and native code decides what an answer allows.
 */

const requestIdPrefix = "localapprq_";
const grantIdPrefix = "localgrant_";
/** What this computer's remembered approvals are held by, where the server's name an agent. */
export const localGrantHolder = "this_computer";

export const isLocalAppRequest = (id: string) => id.startsWith(requestIdPrefix);
export const isLocalGrant = (id: string) => id.startsWith(grantIdPrefix);

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (cause) {
    if (cause instanceof Error) throw cause;
    const message = (cause as { message?: unknown } | null)?.message;
    throw new Error(typeof message === "string" ? message : "That didn’t go through. Try again.");
  }
}

export const localAppsApi = {
  list: () => call<{ available: boolean; apps: ConnectedApp[] }>("composio_apps_list"),
  catalog: (search: string, cursor = "") =>
    call<{ apps: CatalogApp[]; next_cursor: string }>("composio_apps_catalog", { search, cursor }),
  connect: (app: string) => call<{ url: string }>("composio_apps_connect", { app }),
  disconnect: (id: string) => call<void>("composio_apps_disconnect", { id }),
  request: (id: string) => call<{ request: AppRequest }>("composio_request_get", { id }),
  requestLink: (id: string) => call<{ url: string }>("composio_request_link", { id }),
  decide: (id: string, decision: AppRequestDecision) =>
    call<{ request: AppRequest }>("composio_request_decide", { id, decision }),
  grants: () => call<{ grants: AgentGrant[] }>("composio_grants_list"),
  revokeGrant: (id: string) => call<void>("composio_grants_revoke", { id }),
  revokeAllGrants: () => call<void>("composio_grants_revoke", { id: null }),
};
