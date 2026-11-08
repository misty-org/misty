// The desktop's debug bridge (src-tauri/features/browser/agent_pages/eval_bridge), which exists only in
// a debug build and only listens on this computer.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export interface Bridge {
  url: string;
  token: string;
}

export async function bridgeCall<T>(bridge: Bridge, path: string, body: unknown): Promise<T> {
  const response = await fetch(`${bridge.url}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${bridge.token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (response.status === 401) throw new Error("The eval bridge refused the token: MISTY_BROWSER_EVAL_BRIDGE_TOKEN must match the app's.");
  const reply = (await response.json()) as { ok: boolean; result?: T; error?: string };
  if (!reply.ok) throw new Error(reply.error ?? String(response.status));
  return reply.result as T;
}

/** What this device's agents run on, as the app gives its runtime, without the keys. */
export interface DeviceModels {
  models: Record<string, string>;
  reasoning: string | null;
  search: string | null;
}

export async function deviceModels(bridge: Bridge): Promise<DeviceModels> {
  const reply = await bridgeCall<{ models: Record<string, string> | null; reasoning: string | null; search: string | null }>(bridge, "/models", {});
  return { models: reply.models ?? {}, reasoning: reply.reasoning, search: reply.search };
}

/**
 * Runs the body of an async function in the app's window, the same way the app runs itself. It reaches
 * the app's own modules with `module("features/...")` and its argument as `request`.
 */
export function windowCall<T>(bridge: Bridge, script: string, request?: unknown, timeoutMs = 120_000): Promise<T> {
  const prelude = `const module = (path) => import("/@fs${repo}/src/" + path);
const request = ${JSON.stringify(request ?? null)};`;
  return bridgeCall<T>(bridge, "/window-eval", { script: `${prelude}\n${script}`, timeoutMs });
}
