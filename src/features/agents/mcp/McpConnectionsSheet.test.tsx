import { initializeHostAgentsRuntime } from "../hostAgentsRuntime";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mcpConnectionsApi } from "./api";
import { McpConnectionsSheet } from "./McpConnectionsSheet";
import { useMcpConnectionsStore } from "./useMcpConnectionsStore";

vi.mock("@/features/auth", () => ({
  useAccountAvatarUrl: () => undefined,
  useAuth: () => ({ user: { id: "account-1" } }),
}));
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

  it("shows tool connections without an automation service", async () => {
    render(<McpConnectionsSheet open onOpenChange={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Tool connections" })).toBeTruthy();
    expect(
      screen.getByText(/Connect tools your agents can use/i),
    ).toBeTruthy();
    expect(screen.queryByText("Activepieces")).toBeNull();
    expect(screen.queryByRole("button", { name: "Connect" })).toBeNull();
  });


});

initializeHostAgentsRuntime();
