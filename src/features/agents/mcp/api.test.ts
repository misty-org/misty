import { apiRequest } from "@/api/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mcpConnectionsApi } from "./api";

vi.mock("@/api/client", () => ({ apiRequest: vi.fn() }));

describe("mcpConnectionsApi", () => {
  beforeEach(() => vi.mocked(apiRequest).mockReset().mockResolvedValue({}));

  it("matches the frozen remote connection routes and write-only bearer input", async () => {
    await mcpConnectionsApi.list();
    await mcpConnectionsApi.add({
      name: "Design tools",
      endpoint_url: "https://tools.example.com/mcp",
      bearer_token: "secret-once",
    });
    await mcpConnectionsApi.test("connection/1");
    await mcpConnectionsApi.discover("connection/1");
    await mcpConnectionsApi.tools("connection/1");
    await mcpConnectionsApi.remove("connection/1");

    expect(apiRequest).toHaveBeenNthCalledWith(1, "/mcp/connections");
    expect(apiRequest).toHaveBeenNthCalledWith(2, "/mcp/connections", {
      method: "POST",
      body: JSON.stringify({
        name: "Design tools",
        endpoint_url: "https://tools.example.com/mcp",
        bearer_token: "secret-once",
      }),
    });
    expect(apiRequest).toHaveBeenNthCalledWith(3, "/mcp/connections/connection%2F1/test", {
      method: "POST",
    });
    expect(apiRequest).toHaveBeenNthCalledWith(4, "/mcp/connections/connection%2F1/discover", {
      method: "POST",
    });
    expect(apiRequest).toHaveBeenNthCalledWith(5, "/mcp/connections/connection%2F1/tools");
    expect(apiRequest).toHaveBeenNthCalledWith(6, "/mcp/connections/connection%2F1", {
      method: "DELETE",
    });
  });
});
