import { beforeEach, describe, expect, it, vi } from "vitest";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./api", () => ({ spaceRequest: request }));

import { agentArchitectureApi } from "./agentArchitectureApi";

describe("agentArchitectureApi", () => {
  beforeEach(() => request.mockReset().mockResolvedValue({}));

  it("delegates Mika requests through the permission-safe router", async () => {
    await agentArchitectureApi.delegate({ prompt: "summarize receipts", space_id: "space / one", input: { prompt: "summarize receipts" } });
    expect(request).toHaveBeenCalledWith("/mika/delegations", {
      method: "POST",
      body: JSON.stringify({ prompt: "summarize receipts", space_id: "space / one", input: { prompt: "summarize receipts" } }),
    });
  });

  it("creates isolated direct runs with encoded ownership identifiers", async () => {
    await agentArchitectureApi.run("space / one", "agent#one", { prompt: "go", capability_id: "organize", input: { prompt: "go" } });
    expect(request).toHaveBeenCalledWith("/spaces/space%20%2F%20one/agents/agent%23one/runs", {
      method: "POST",
      body: JSON.stringify({ prompt: "go", capability_id: "organize", input: { prompt: "go" } }),
    });
  });

  it("replaces workflows explicitly and records approval decisions", async () => {
    await agentArchitectureApi.replaceAgentWorkflow("space", "agent", "version-2");
    expect(request).toHaveBeenLastCalledWith("/spaces/space/studio/agents/agent/workflow", {
      method: "PUT",
      body: JSON.stringify({ workflow_version_id: "version-2" }),
    });
    await agentArchitectureApi.decideRun("run/one", false);
    expect(request).toHaveBeenLastCalledWith("/runs/run%2Fone/approval", {
      method: "POST",
      body: JSON.stringify({ approved: false }),
    });
  });

  it("keeps private conversation messages on their dedicated endpoint", async () => {
    await agentArchitectureApi.sendConversationMessage("private/one", { prompt: "hello", input: { prompt: "hello" } });
    expect(request).toHaveBeenCalledWith("/agent-conversations/private%2Fone/events", {
      method: "POST",
      body: JSON.stringify({ prompt: "hello", input: { prompt: "hello" } }),
    });
  });
});
