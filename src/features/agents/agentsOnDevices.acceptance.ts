import { beforeAll, describe, expect, it } from "vitest";
import { liveAcceptanceEnabled } from "@/tests/acceptance/liveEnv";
import { MistyClient } from "@/tests/acceptance/mistyClient";

// Agents on this computer, live on the local server: the keep-awake setting and
// the request state a device reads to end the agent's own session.
// server/test/contract/http/api/remote_sessions_test.go covers the session itself
// with real keys.
let client: MistyClient;

describe.skipIf(!liveAcceptanceEnabled)("agents on devices on the local server", () => {
  beforeAll(async () => {
    client = await MistyClient.register();
  }, 120_000);

  it("keeps computers awake by default, and saves the choice", async () => {
    type Settings = { settings: { keep_awake_for_agents?: boolean } };
    const initial = await client.json<Settings>("/ai/settings");
    expect(initial.settings.keep_awake_for_agents).toBe(true);
    const off = await client.json<Settings>("/ai/settings/keep-awake", {
      method: "PUT",
      body: JSON.stringify({ keep_awake_for_agents: false }),
    });
    expect(off.settings.keep_awake_for_agents).toBe(false);
    expect((await client.json<Settings>("/ai/settings")).settings.keep_awake_for_agents).toBe(
      false,
    );
    await client.json("/ai/settings/keep-awake", {
      method: "PUT",
      body: JSON.stringify({ keep_awake_for_agents: true }),
    });
  });

  it("reports a request's state to the account's devices", async () => {
    const agents = await client.json<{ agents: Array<{ id: string }> }>("/misty/agents");
    const run = await client.invoke(
      "Reply with the single word: ready",
      { agent_id: agents.agents[0]?.id },
      180_000,
    );
    expect(run.terminal).toBe("invocation.completed");
    const state = await client.json<{ state: string }>(
      `/ai/invocations/${encodeURIComponent(run.invocationId)}/state`,
    );
    expect(state.state).toBe("completed");
  }, 200_000);
});
