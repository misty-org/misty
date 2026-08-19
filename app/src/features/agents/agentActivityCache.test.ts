import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentsApi } from "@/api/agents/api";
import {
  cachedAgentActivity,
  clearAgentActivityCache,
  loadAgentActivity,
} from "./agentActivityCache";

vi.mock("@/api/agents/api", () => ({
  agentsApi: { activity: vi.fn(), run: vi.fn() },
}));

describe("agent activity cache", () => {
  beforeEach(() => {
    clearAgentActivityCache();
    vi.clearAllMocks();
    vi.mocked(agentsApi.activity).mockResolvedValue({ runs: [] });
  });

  it("deduplicates simultaneous activity requests and reuses a fresh result", async () => {
    await Promise.all([
      loadAgentActivity("agent-1"),
      loadAgentActivity("agent-1"),
      loadAgentActivity("agent-1"),
    ]);
    await loadAgentActivity("agent-1");
    expect(agentsApi.activity).toHaveBeenCalledOnce();
  });

  it("does not let an older activity request overwrite a forced refresh", async () => {
    let resolveStale!: (value: never) => void;
    vi.mocked(agentsApi.activity)
      .mockImplementationOnce(() => new Promise((resolve) => (resolveStale = resolve)))
      .mockResolvedValueOnce({ agent_id: "agent-1", queue_count: 1, runs: [{ run_id: "new" }] });

    const stale = loadAgentActivity("agent-1");
    const fresh = loadAgentActivity("agent-1", true);
    await expect(fresh).resolves.toMatchObject({ runs: [{ run_id: "new" }] });
    resolveStale({ agent_id: "agent-1", queue_count: 0, runs: [] } as never);
    await stale;

    expect(cachedAgentActivity("agent-1")).toMatchObject({ runs: [{ run_id: "new" }] });
  });
});
