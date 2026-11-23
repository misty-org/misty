import { beforeAll, describe, expect, it } from "vitest";
import { liveAcceptanceEnabled } from "@/tests/acceptance/live_env";
import { defaultAgentId, MistyClient, runStateOf } from "@/tests/acceptance/misty_client";

let client: MistyClient;

describe.skipIf(!liveAcceptanceEnabled)("agents on this computer", () => {
  beforeAll(async () => {
    client = new MistyClient();
  }, 120_000);

  it("reports a run's state", async () => {
    const run = await client.invoke(
      "Reply with the single word: ready",
      { agentId: await defaultAgentId() },
      180_000,
    );
    expect(run.terminal).toBe("invocation.completed");
    await expect(runStateOf(run.invocationId)).resolves.toBe("completed");
  }, 200_000);
});
