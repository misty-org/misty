import { beforeEach, describe, expect, it, vi } from "vitest";
import { mcpConnectionsApi } from "./api";
import type { McpConnection, McpToolBinding, McpToolDescriptor } from "./types";
import { useMcpConnectionsStore } from "./useMcpConnectionsStore";

vi.mock("./api", () => ({
  mcpConnectionsApi: {
    list: vi.fn(),
    add: vi.fn(),
    test: vi.fn(),
    discover: vi.fn(),
    tools: vi.fn(),
    remove: vi.fn(),
    agentTools: vi.fn(),
    setAgentTools: vi.fn(),
    executions: vi.fn(),
  },
}));

describe("useMcpConnectionsStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useMcpConnectionsStore.getState().reset();
  });

  it("isolates provider failures and stale account responses", async () => {
    const staleList = deferred<{ connections: McpConnection[] }>();
    vi.mocked(mcpConnectionsApi.list)
      .mockReturnValueOnce(staleList.promise)
      .mockResolvedValueOnce({ connections: [connection("current"), connection("broken")] });
    vi.mocked(mcpConnectionsApi.tools)
      .mockResolvedValueOnce({ tools: [tool("current", "search")] })
      .mockRejectedValueOnce(new Error("provider down"));

    const stale = useMcpConnectionsStore.getState().load("account-a");
    await useMcpConnectionsStore.getState().load("account-b");
    staleList.resolve({ connections: [connection("stale")] });
    await stale;

    expect(useMcpConnectionsStore.getState().scopeKey).toBe("account-b");
    expect(useMcpConnectionsStore.getState().connections.map((item) => item.id)).toEqual([
      "current",
      "broken",
    ]);
    expect(useMcpConnectionsStore.getState().tools.map((item) => item.remote_name)).toEqual([
      "search",
    ]);
    expect(useMcpConnectionsStore.getState().failedToolConnectionIds).toEqual(["broken"]);
    expect(useMcpConnectionsStore.getState().error).toContain("Tool changes are paused");
  });

  it("keeps bearer input write-only and every discovered tool disabled by default", async () => {
    const publicConnection = connection("connection-1") as McpConnection & {
      bearer_token?: string;
    };
    publicConnection.bearer_token = "server-must-not-return-this";
    vi.mocked(mcpConnectionsApi.add).mockResolvedValue({ connection: publicConnection });
    vi.mocked(mcpConnectionsApi.discover).mockResolvedValue({
      connection: publicConnection,
      snapshot: {},
      tools: [tool("connection-1", "create_item")],
    });
    useMcpConnectionsStore.setState({ scopeKey: "account-1" });

    await useMcpConnectionsStore.getState().add({
      name: "Tools",
      endpoint_url: "https://tools.example.com/mcp",
      bearer_token: "sent-once",
    });

    expect(JSON.stringify(useMcpConnectionsStore.getState())).not.toContain("sent-once");
    expect(JSON.stringify(useMcpConnectionsStore.getState())).not.toContain(
      "server-must-not-return-this",
    );
    expect(useMcpConnectionsStore.getState().enabledByAgent).toEqual({});
    expect(localStorage.length).toBe(0);
  });

  it("sends a complete explicit per-agent selection and clears it on account reset", async () => {
    const first = tool("connection-1", "search");
    const second = tool("connection-1", "create_item");
    vi.mocked(mcpConnectionsApi.setAgentTools).mockResolvedValue({
      agent_id: "agent-1",
      tools: [binding(first, true), binding(second, false)],
    });
    useMcpConnectionsStore.setState({
      scopeKey: "account-1",
      connections: [connection("connection-1")],
      tools: [first, second],
    });

    await useMcpConnectionsStore
      .getState()
      .setToolEnabled("agent-1", "connection-1", "search", true);

    expect(mcpConnectionsApi.setAgentTools).toHaveBeenCalledWith("agent-1", [
      { connection_id: "connection-1", remote_name: "search", enabled: true },
      { connection_id: "connection-1", remote_name: "create_item", enabled: false },
    ]);
    expect(useMcpConnectionsStore.getState().enabledByAgent["agent-1"]).toEqual([
      "connection-1:search",
    ]);

    useMcpConnectionsStore.getState().reset();
    expect(useMcpConnectionsStore.getState().scopeKey).toBe("");
    expect(useMcpConnectionsStore.getState().enabledByAgent).toEqual({});
    expect(useMcpConnectionsStore.getState().failedToolConnectionIds).toEqual([]);
  });

  it("blocks replacement updates while any connection catalog is incomplete", async () => {
    const first = tool("connection-1", "search");
    useMcpConnectionsStore.setState({
      scopeKey: "account-1",
      connections: [connection("connection-1"), connection("connection-2")],
      tools: [first],
      failedToolConnectionIds: ["connection-2"],
    });

    await useMcpConnectionsStore
      .getState()
      .setToolEnabled("agent-1", "connection-1", "search", true);

    expect(mcpConnectionsApi.setAgentTools).not.toHaveBeenCalled();
    expect(useMcpConnectionsStore.getState().error).toContain("existing Agent access");
  });
});

function connection(id: string): McpConnection {
  return {
    id,
    name: id,
    endpoint_url: `https://${id}.example.com/mcp`,
    transport: "streamable_http",
    status: "active",
    tool_count: 1,
    created_at: "2026-08-19T00:00:00Z",
    updated_at: "2026-08-19T00:00:00Z",
  };
}

function tool(connectionId: string, remoteName: string): McpToolDescriptor {
  return {
    connection_id: connectionId,
    remote_name: remoteName,
    stable_name: `${connectionId}::${remoteName}`,
    description: "Remote action",
    input_schema: {},
    schema_status: "valid",
    default_risk: "write",
    approval: "interactive",
    locality: "provider",
    discovered_at: "2026-08-19T00:00:00Z",
    classification: "unknown",
    approval_required: true,
  };
}

function binding(toolValue: McpToolDescriptor, enabled: boolean): McpToolBinding {
  return {
    connection_id: toolValue.connection_id,
    connection_name: "Tools",
    remote_name: toolValue.remote_name,
    stable_name: toolValue.stable_name,
    description: toolValue.description,
    input_schema: toolValue.input_schema,
    schema_status: toolValue.schema_status,
    disabled_reason: toolValue.disabled_reason,
    enabled,
    default_risk: "write",
    approval: "interactive",
    locality: "provider",
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
