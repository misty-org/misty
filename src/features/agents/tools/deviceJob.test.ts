import { expect, it, vi } from "vitest";
import { browserToolConfig } from "./deviceJob";
import type { RunEntry } from "./runContexts";

vi.mock("@/features/agents/runs/invocations/localAiSettings", () => ({
  readAgentSettings: vi.fn(),
}));
vi.mock("../runs/jobs/workerExecute", () => ({}));

const entry = (over: Partial<RunEntry> = {}) => ({ agentId: "agent", ...over }) as RunEntry;

it("carries the agent and the call, and no policy a window could change", () => {
  expect(browserToolConfig(entry(), "call-1")).toEqual({ agentId: "agent", policyCall: "call-1" });
  expect(browserToolConfig(entry({ agentId: "" }))).toEqual({ agentId: "misty-unified" });
});
