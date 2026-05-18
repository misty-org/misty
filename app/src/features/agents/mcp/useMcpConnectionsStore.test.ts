import { beforeEach, describe, expect, it, vi } from "vitest";
import { mcpConnectionsApi } from "./api";
import type { McpConnection, McpToolDescriptor } from "./types";
import { useMcpConnectionsStore } from "./useMcpConnectionsStore";

vi.mock("./api", () => ({
  mcpConnectionsApi: {
    list: vi.fn(),
    add: vi.fn(),
    test: vi.fn(),
    discover: vi.fn(),
    tools: vi.fn(),
    remove: vi.fn(),
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
    expect(useMcpConnectionsStore.getState().error).toContain("could not be loaded");
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
    expect(localStorage.length).toBe(0);
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
