import { beforeEach, describe, expect, it } from "vitest";
import { useMcpConnectionsStore } from "../mcp/useMcpConnectionsStore";
import { resetAllAgentAccountState } from "./agentAccountLifecycle";

describe("Agent account lifecycle", () => {
  beforeEach(() => {
    localStorage.clear();
    useMcpConnectionsStore.getState().reset();
  });

  it("clears Misty tool connections and retired local Agent state on account reset", () => {
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
      failedToolConnectionIds: ["connection-2"],
    });
    localStorage.setItem("misty.agentDock.agent-1", "legacy");

    resetAllAgentAccountState();

    expect(useMcpConnectionsStore.getState()).toMatchObject({
      scopeKey: "",
      connections: [],
      tools: [],
      failedToolConnectionIds: [],
    });
    expect(localStorage.getItem("misty.agentDock.agent-1")).toBeNull();
  });
});
