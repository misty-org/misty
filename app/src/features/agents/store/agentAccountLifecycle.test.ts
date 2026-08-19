import { beforeEach, describe, expect, it } from "vitest";
import { useMcpConnectionsStore } from "../mcp/useMcpConnectionsStore";
import { resetAllAgentAccountState } from "./agentAccountLifecycle";
import { usePersonalAgentsStore } from "./usePersonalAgentsStore";

describe("Agent account lifecycle", () => {
  beforeEach(() => {
    localStorage.clear();
    useMcpConnectionsStore.getState().reset();
  });

  it("clears connection, tool, execution, and Agent state on account reset", () => {
    usePersonalAgentsStore.setState({ loaded: true });
    useMcpConnectionsStore.setState({
      scopeKey: "account-1",
      connections: [
        {
          id: "connection-1",
          name: "Tools",
          endpoint_url: "https://tools.example.com/mcp",
          transport: "streamable_http",
          status: "active",
          tool_count: 1,
          created_at: "2026-08-19T00:00:00Z",
          updated_at: "2026-08-19T00:00:00Z",
        },
      ],
      enabledByAgent: { "agent-1": ["connection-1:search"] },
      executionsByAgent: {
        "agent-1": [
          {
            id: "execution-1",
            agent_id: "agent-1",
            connection_id: "connection-1",
            remote_name: "search",
            stable_name: "connection-1::search",
            source: "agent_run",
            approved: true,
            success: true,
            duration_ms: 20,
            created_at: "2026-08-19T00:00:00Z",
          },
        ],
      },
      failedToolConnectionIds: ["connection-2"],
    });
    localStorage.setItem("misty.agentDock.agent-1", "legacy");

    resetAllAgentAccountState();

    expect(usePersonalAgentsStore.getState().loaded).toBe(false);
    expect(useMcpConnectionsStore.getState()).toMatchObject({
      scopeKey: "",
      connections: [],
      tools: [],
      executionsByAgent: {},
      enabledByAgent: {},
      failedToolConnectionIds: [],
    });
    expect(localStorage.getItem("misty.agentDock.agent-1")).toBeNull();
  });
});
