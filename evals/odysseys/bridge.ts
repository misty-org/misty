// The desktop's debug bridge (src-tauri/src/infra/browser/eval_bridge), which exists only in
// a debug build and only listens on this computer.

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

/**
 * Which runtime the app is really on. `MISTY_ODYSSEYS_RUNTIME` names what the person means to measure,
 * and the debug app's bridge knows what it started: a report mustn't carry a label that isn't true.
 */
export function assertRuntime(meant: string, running: string | undefined): void {
  if (running !== meant)
    throw new Error(
      `This pass says it measures the ${meant} runtime, but the app is on ${running ?? "an unknown runtime"}. ` +
        "Start the app with MISTY_AGENT_RUNTIME=typescript to measure TypeScript, and without it to measure Rust.",
    );
}

export async function deviceModels(bridge: Bridge): Promise<DeviceModels> {
  return (await deviceState(bridge)).device;
}

/** The device's models and, from the app itself, the runtime it's on. */
export async function deviceState(bridge: Bridge): Promise<{ device: DeviceModels; runtime: string | undefined }> {
  const reply = await bridgeCall<{ models: Record<string, string> | null; reasoning: string | null; search: string | null; runtime?: string }>(bridge, "/models", {});
  return { device: { models: reply.models ?? {}, reasoning: reply.reasoning, search: reply.search }, runtime: reply.runtime };
}
