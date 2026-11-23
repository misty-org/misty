import { invoke } from "@/native/invoke";
import type { AgentGrant } from "../grants/api";
import type { AppRequest, AppRequestDecision } from "./api";

const grantIdPrefix = "localgrant_";
export const localGrantHolder = "this_computer";

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
  request: (id: string) => call<{ request: AppRequest }>("apps_request_get", { id }),
  decide: (id: string, decision: AppRequestDecision) =>
    call<{ request: AppRequest }>("apps_request_decide", { id, decision }),
  grants: () => call<{ grants: AgentGrant[] }>("apps_grants_list"),
  revokeGrant: (id: string) => call<void>("apps_grants_revoke", { id }),
  revokeAllGrants: () => call<void>("apps_grants_revoke", { id: null }),
};
