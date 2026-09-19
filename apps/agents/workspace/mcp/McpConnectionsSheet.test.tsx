import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mcpConnectionsApi } from "./api";
import { McpConnectionsSheet } from "./McpConnectionsSheet";
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

  it("keeps the built-in automation engine out of user-managed tool connections", async () => {
    render(<McpConnectionsSheet open onOpenChange={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Tool connections" })).toBeTruthy();
    expect(
      screen.getByText(/built-in automation engine is managed by your Misty server/i),
    ).toBeTruthy();
    expect(screen.queryByText("Activepieces")).toBeNull();
    expect(screen.queryByRole("button", { name: "Connect" })).toBeNull();
  });

  it("does not expose a legacy Activepieces OAuth connection", async () => {
    vi.mocked(mcpConnectionsApi.list).mockResolvedValue({
      connections: [
        {
          id: "activepieces-1",
          name: "Activepieces",
          endpoint_url: "https://automations.example.com/mcp",
          transport: "streamable_http",
          provider: "activepieces",
          status: "active",
          tool_count: 8,
          created_at: "2026-08-29T20:00:00Z",
          updated_at: "2026-08-29T20:00:00Z",
        },
      ],
    });
    render(<McpConnectionsSheet open onOpenChange={vi.fn()} />);

    expect(screen.queryByText("8 automation tools ready in Misty")).toBeNull();
  });
});
