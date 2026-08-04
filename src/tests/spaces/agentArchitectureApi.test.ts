import { beforeEach, describe, expect, it, vi } from "vitest";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/stores/spaces/useSpacesBackendStore", () => ({ spaceRequest: request }));

import { agentArchitectureApi } from "@/stores/agents/useAgentArchitectureStore";
import { personalAgentsApi } from "@/stores/agents/usePersonalAgentsStore";
import { createSpaceAgentMembershipsApi } from "@/stores/spaces/spaceAgentMembershipsApi";

describe("agentArchitectureApi", () => {
  beforeEach(() => request.mockReset().mockResolvedValue({}));

  it("delegates agent requests through the permission-safe router", async () => {
    await agentArchitectureApi.delegate({
      prompt: "summarize receipts",
      space_id: "space / one",
      input: { prompt: "summarize receipts" },
    });
    expect(request).toHaveBeenCalledWith("/agents/delegations", {
      method: "POST",
      body: JSON.stringify({
        prompt: "summarize receipts",
        space_id: "space / one",
        input: { prompt: "summarize receipts" },
      }),
    });
  });

  it("discovers authorized Spaces and Agent capabilities together", async () => {
    await agentArchitectureApi.discovery();
    expect(request).toHaveBeenCalledWith("/agents/discovery");
  });

  it("creates isolated direct runs with encoded ownership identifiers", async () => {
    await agentArchitectureApi.run("space / one", "agent#one", {
      prompt: "go",
      capability_id: "organize",
      input: { prompt: "go" },
    });
    expect(request).toHaveBeenCalledWith("/spaces/space%20%2F%20one/agents/agent%23one/runs", {
      method: "POST",
      body: JSON.stringify({ prompt: "go", capability_id: "organize", input: { prompt: "go" } }),
    });
  });

  it("publishes pinned workflow attachments and records approval decisions", async () => {
    await agentArchitectureApi.publishAgentVersion("space", "agent", [
      { workflow_version_id: "version-2", alias: "primary", enabled: true, position: 0 },
    ]);
    expect(request).toHaveBeenLastCalledWith("/spaces/space/studio/agents/agent/versions", {
      method: "POST",
      body: JSON.stringify({
        workflows: [
          { workflow_version_id: "version-2", alias: "primary", enabled: true, position: 0 },
        ],
      }),
    });
    await agentArchitectureApi.decideRun("run/one", false);
    expect(request).toHaveBeenLastCalledWith("/runs/run%2Fone/approval", {
      method: "POST",
      body: JSON.stringify({ approved: false }),
    });
    await agentArchitectureApi.cancelRun("run/one");
    expect(request).toHaveBeenLastCalledWith("/runs/run%2Fone/cancel", { method: "POST" });
    await agentArchitectureApi.retryRun("run/one");
    expect(request).toHaveBeenLastCalledWith("/runs/run%2Fone/retry", { method: "POST" });
  });

  it("keeps private conversation messages on their dedicated endpoint", async () => {
    await agentArchitectureApi.sendConversationMessage("private/one", {
      prompt: "hello",
      input: { prompt: "hello" },
    });
    expect(request).toHaveBeenCalledWith("/agent-conversations/private%2Fone/events", {
      method: "POST",
      body: JSON.stringify({ prompt: "hello", input: { prompt: "hello" } }),
    });
  });

  it("loads provider availability with the member's Space connections", async () => {
    await agentArchitectureApi.integrations("space / one");
    expect(request).toHaveBeenCalledWith("/spaces/space%20%2F%20one/integrations");
  });

  it("updates exact Agent Toolbox capability grants", async () => {
    const grants = [
      { capability: "tasks.query", risk: "read" as const },
      { capability: "tasks.update", risk: "write" as const },
    ];
    await agentArchitectureApi.updateInstanceCapabilities("instance / one", grants);
    expect(request).toHaveBeenCalledWith("/agent-instances/instance%20%2F%20one/capabilities", {
      method: "PUT",
      body: JSON.stringify({ grants }),
    });
  });

  it("loads server-owned Toolbox actions for instances and personal Agents", async () => {
    await agentArchitectureApi.instanceToolbox("instance / one");
    expect(request).toHaveBeenLastCalledWith("/agent-instances/instance%20%2F%20one/toolbox");
    await personalAgentsApi.toolbox("personal / one");
    expect(request).toHaveBeenLastCalledWith("/agents/personal%20%2F%20one/toolbox");
    await personalAgentsApi.toolboxCatalog();
    expect(request).toHaveBeenLastCalledWith("/agents/toolbox");
  });

  it("loads the public effective Toolbox manual for a Space teammate", async () => {
    const membershipApi = createSpaceAgentMembershipsApi(request);
    await membershipApi.spaceAgentToolbox("space / one", "personal / one");
    expect(request).toHaveBeenLastCalledWith(
      "/spaces/space%20%2F%20one/agents/personal%20%2F%20one/toolbox",
    );
  });

  it("uploads an immutable custom avatar through the Agent endpoint", async () => {
    const file = new File(["avatar"], "avatar.webp", { type: "image/webp" });
    await personalAgentsApi.uploadAvatar("personal / one", file);
    expect(request).toHaveBeenLastCalledWith("/agents/personal%20%2F%20one/avatar", {
      method: "PUT",
      headers: { "Content-Type": "image/webp" },
      body: file,
    });
  });
});
