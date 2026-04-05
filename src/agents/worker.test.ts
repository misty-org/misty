import { describe, expect, it } from "vitest";
import { deviceContentReference, deviceWorkflowErrorCode } from "./worker";

describe("v2 device workflow node worker", () => {
  it("accepts an opaque scope and relative content locator", () => {
    expect(deviceContentReference({
      contentRef: {
        sourceKind: "local_file",
        permissionScope: "scope_123",
        locator: "reports/quarterly.pdf",
      },
    }, "scope_123")).toMatchObject({
      permissionScope: "scope_123",
      locator: "reports/quarterly.pdf",
      scopeId: "scope_123",
      relativePath: "reports/quarterly.pdf",
    });
  });

  it("rejects scope mismatches and path traversal", () => {
    expect(() => deviceContentReference({ scopeId: "scope_a", relativePath: "report.pdf" }, "scope_b"))
      .toThrow("invalid_device_scope");
    expect(() => deviceContentReference({ scopeId: "scope_a", relativePath: "../report.pdf" }, "scope_a"))
      .toThrow("invalid_device_scope");
  });

  it("returns stable coordinator error codes", () => {
    expect(deviceWorkflowErrorCode(new Error("unsupported_content:image/png"))).toBe("unsupported_content");
    expect(deviceWorkflowErrorCode(new Error("device_node_timeout"))).toBe("device_timeout");
  });
});
