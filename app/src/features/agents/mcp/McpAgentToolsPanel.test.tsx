import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mcpConnectionsApi } from "./api";
import { McpAgentToolsPanel } from "./McpAgentToolsPanel";
import type { McpConnection, McpToolBinding, McpToolDescriptor } from "./types";
import { useMcpConnectionsStore } from "./useMcpConnectionsStore";

vi.mock("@/features/auth", () => ({ useAuth: () => ({ user: { id: "account-1" } }) }));
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

describe("McpAgentToolsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMcpConnectionsStore.getState().reset();
    vi.mocked(mcpConnectionsApi.list).mockResolvedValue({ connections: [connection] });
    vi.mocked(mcpConnectionsApi.tools).mockResolvedValue({ tools: [tool] });
    vi.mocked(mcpConnectionsApi.agentTools).mockResolvedValue({
      agent_id: "agent-1",
      tools: [binding(false)],
    });
    vi.mocked(mcpConnectionsApi.executions).mockResolvedValue({
      executions: [
        {
          id: "execution-1",
          agent_id: "agent-1",
          connection_id: "connection-1",
          remote_name: "create_item",
          stable_name: "connection-1::create_item",
          source: "agent_run",
          approved: false,
          success: false,
          duration_ms: 10,
          created_at: "2026-08-19T00:00:00Z",
        },
      ],
    });
    vi.mocked(mcpConnectionsApi.setAgentTools).mockResolvedValue({
      agent_id: "agent-1",
      tools: [binding(true)],
    });
  });
  afterEach(cleanup);

  it("renders discovered tools off, marks approval/risk, and enables only after an explicit switch", async () => {
    render(<McpAgentToolsPanel agentId="agent-1" />);

    const toggle = await screen.findByRole("switch", { name: "Allow Create Item" });
    expect(toggle.getAttribute("data-state")).toBe("unchecked");
    expect(screen.getByText("Can make changes")).toBeTruthy();
    expect(screen.getByText("Approval required")).toBeTruthy();
    expect(await screen.findByText("Denied")).toBeTruthy();
    fireEvent.click(toggle);

    await waitFor(() =>
      expect(mcpConnectionsApi.setAgentTools).toHaveBeenCalledWith("agent-1", [
        { connection_id: "connection-1", remote_name: "create_item", enabled: true },
      ]),
    );
  });

  it("pauses tool switches when any provider catalog failed to load", async () => {
    vi.mocked(mcpConnectionsApi.list).mockResolvedValue({
      connections: [connection, { ...connection, id: "connection-2" }],
    });
    vi.mocked(mcpConnectionsApi.tools)
      .mockResolvedValueOnce({ tools: [tool] })
      .mockRejectedValueOnce(new Error("provider unavailable"));

    render(<McpAgentToolsPanel agentId="agent-1" />);

    const toggle = await screen.findByRole("switch", { name: "Allow Create Item" });
    await waitFor(() => expect(toggle.hasAttribute("disabled")).toBe(true));
    expect(screen.getByRole("alert").textContent).toContain("Tool changes are paused");
  });
});

const connection: McpConnection = {
  id: "connection-1",
  name: "Design tools",
  endpoint_url: "https://tools.example.com/mcp",
  transport: "streamable_http",
  status: "active",
  tool_count: 1,
  created_at: "2026-08-19T00:00:00Z",
  updated_at: "2026-08-19T00:00:00Z",
};

const tool: McpToolDescriptor = {
  connection_id: "connection-1",
  remote_name: "create_item",
  stable_name: "connection-1::create_item",
  description: "Creates an item",
  input_schema: {},
  schema_status: "valid",
  default_risk: "write",
  approval: "interactive",
  locality: "provider",
  discovered_at: "2026-08-19T00:00:00Z",
  classification: "unknown",
  approval_required: true,
};

function binding(enabled: boolean): McpToolBinding {
  return {
    connection_id: tool.connection_id,
    connection_name: "Design tools",
    remote_name: tool.remote_name,
    stable_name: tool.stable_name,
    description: tool.description,
    input_schema: tool.input_schema,
    schema_status: tool.schema_status,
    enabled,
    default_risk: "write",
    approval: "interactive",
    locality: "provider",
  };
}
