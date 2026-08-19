import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mcpConnectionsApi } from "./api";
import { McpConnectionsSheet } from "./McpConnectionsSheet";
import type { McpConnection } from "./types";
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

describe("McpConnectionsSheet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMcpConnectionsStore.getState().reset();
    vi.mocked(mcpConnectionsApi.list).mockResolvedValue({ connections: [] });
  });
  afterEach(cleanup);

  it("adds a remote server without retaining its bearer token or claiming unsupported modes", async () => {
    vi.mocked(mcpConnectionsApi.add).mockResolvedValue({ connection });
    vi.mocked(mcpConnectionsApi.discover).mockResolvedValue({
      connection: { ...connection, tool_count: 1 },
      snapshot: {},
      tools: [],
    });
    render(<McpConnectionsSheet open onOpenChange={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Tool connections" })).toBeTruthy();
    expect(screen.getByText("Remote connections only")).toBeTruthy();
    expect(screen.queryByText(/OAuth/i)).toBeNull();
    expect(screen.queryByText(/device-local|stdio/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add connection" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Design tools" } });
    fireEvent.change(screen.getByLabelText("Server URL"), {
      target: { value: "https://tools.example.com/mcp" },
    });
    fireEvent.change(screen.getByLabelText("Access token (optional)"), {
      target: { value: "secret-once" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() =>
      expect(mcpConnectionsApi.add).toHaveBeenCalledWith({
        name: "Design tools",
        endpoint_url: "https://tools.example.com/mcp",
        bearer_token: "secret-once",
      }),
    );
    expect(JSON.stringify(useMcpConnectionsStore.getState())).not.toContain("secret-once");
  });
});

const connection: McpConnection = {
  id: "connection-1",
  name: "Design tools",
  endpoint_url: "https://tools.example.com/mcp",
  transport: "streamable_http",
  status: "active",
  tool_count: 0,
  created_at: "2026-08-19T00:00:00Z",
  updated_at: "2026-08-19T00:00:00Z",
};
