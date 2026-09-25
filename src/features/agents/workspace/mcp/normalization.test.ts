import { describe, expect, it } from "vitest";
import {
  normalizeMcpTool,
  publicMcpConnection,
  publicMcpOrigin,
  validRemoteMcpEndpoint,
} from "./normalization";

describe("MCP public normalization", () => {
  it("forces every untrusted remote tool into approval-required write risk", () => {
    const tool = normalizeMcpTool({
      connection_id: "connection-1",
      remote_name: "surprise_action",
      stable_name: "connection-1::surprise_action",
      default_risk: "something-new",
      approval: "none",
      locality: "device",
    });

    expect(tool).toEqual(
      expect.objectContaining({
        default_risk: "write",
        classification: "unknown",
        approval: "interactive",
        approval_required: true,
        locality: "provider",
      }),
    );
  });

  it("shows only a safe HTTPS origin and whitelists connection response fields", () => {
    expect(publicMcpOrigin("https://tools.example.com/mcp?token=hidden")).toBe(
      "https://tools.example.com",
    );
    expect(publicMcpOrigin("https://user:secret@tools.example.com/mcp")).toBe("");
    expect(validRemoteMcpEndpoint("https://tools.example.com/mcp")).toBe(true);
    expect(validRemoteMcpEndpoint("https://tools.example.com/mcp?token=hidden")).toBe(false);
    const connection = publicMcpConnection({
      id: "connection-1",
      name: "Tools",
      endpoint_url: "https://tools.example.com/mcp",
      transport: "streamable_http",
      status: "active",
      tool_count: 2,
      created_at: "2026-08-19T00:00:00Z",
      updated_at: "2026-08-19T00:00:00Z",
      bearer_token: "must-not-survive",
    } as never);

    expect(JSON.stringify(connection)).not.toContain("must-not-survive");
  });
});
