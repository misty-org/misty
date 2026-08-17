import { describe, expect, it } from "vitest";
import {
  browserAgentExecutionRequest,
  deviceContentReference,
  deviceWorkflowErrorCode,
} from "./worker";

describe("v2 device workflow node worker", () => {
  it("accepts an opaque scope and relative content locator", () => {
    expect(
      deviceContentReference(
        {
          contentRef: {
            sourceKind: "local_file",
            permissionScope: "scope_123",
            locator: "reports/quarterly.pdf",
          },
        },
        "scope_123",
      ),
    ).toMatchObject({
      permissionScope: "scope_123",
      locator: "reports/quarterly.pdf",
      scopeId: "scope_123",
      relativePath: "reports/quarterly.pdf",
    });
  });

  it("rejects scope mismatches and path traversal", () => {
    expect(() =>
      deviceContentReference({ scopeId: "scope_a", relativePath: "report.pdf" }, "scope_b"),
    ).toThrow("invalid_device_scope");
    expect(() =>
      deviceContentReference({ scopeId: "scope_a", relativePath: "../report.pdf" }, "scope_a"),
    ).toThrow("invalid_device_scope");
  });

  it("returns stable coordinator error codes", () => {
    expect(deviceWorkflowErrorCode(new Error("unsupported_content:image/png"))).toBe(
      "unsupported_content",
    );
    expect(deviceWorkflowErrorCode(new Error("device_node_timeout"))).toBe("device_timeout");
  });

  it("binds browser jobs to their server-selected grant, scope, and agent", () => {
    expect(
      browserAgentExecutionRequest({
        id: "job",
        runId: "run",
        nodeId: "node",
        scopeId: "browser-tab-1",
        operation: "browser.inspect",
        deviceGrantId: "grant-1",
        attempt: 1,
        input: { scopeId: "browser-tab-1" },
        config: { agentId: "agent-1" },
      }),
    ).toMatchObject({
      scopeId: "browser-tab-1",
      grantId: "grant-1",
      agentId: "agent-1",
      operation: "browser.inspect",
    });
  });

  it("rejects browser jobs missing local grant identity", () => {
    expect(() =>
      browserAgentExecutionRequest({
        id: "job",
        runId: "run",
        nodeId: "node",
        scopeId: "browser-tab-1",
        operation: "browser.click",
        attempt: 1,
        input: {},
        config: {},
      }),
    ).toThrow("invalid_browser_grant");
  });
});
