import { expect, it, vi } from "vitest";
import { browserToolConfig } from "./device_job";
import type { RunEntry } from "./run_contexts";

vi.mock("@/features/agents/runs/invocations/local_ai_settings", () => ({
  readAgentSettings: vi.fn(),
}));
vi.mock("../runs/jobs/worker_execute", () => ({}));

const entry = (over: Partial<RunEntry> = {}) => ({ agentId: "agent", ...over }) as RunEntry;

it("carries the agent and the call, and no policy a window could change", () => {
  expect(browserToolConfig(entry(), "call-1")).toEqual({ agentId: "agent", policyCall: "call-1" });
  expect(browserToolConfig(entry({ agentId: "" }))).toEqual({ agentId: "misty-unified" });
});
