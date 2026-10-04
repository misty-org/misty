import { describe, expect, it } from "vitest";
import { isBrowserSnapshotStale } from "./workerDeviceJobs";
import {
  browserAgentExecutionRequest,
  browserDeviceRequest,
  deviceExecutionRemaining,
  deviceContentReference,
  deviceWorkflowErrorCode,
} from "./worker";

describe("task download uploads", () => {
  const job = {
    id: "upload-job",
    runId: "run",
    nodeId: "node",
    scopeId: "drive-scope",
    operation: "browser.upload",
    contextId: "context",
    attempt: 1,
    input: { downloadId: "download-one", sourceScopeId: "image-scope" },
    config: {
      agentId: "agent-one",
      taskId: "task-one",
      downloadUpload: { downloadId: "download-one", sourceScopeId: "image-scope" },
    },
  };
  it("passes an authorized receipt to native without exposing file contents", async () => {
    const request = await browserDeviceRequest(job);
    expect(request.input).toMatchObject({
      downloadId: "download-one",
      sourceScopeId: "image-scope",
      __mistyTaskId: "task-one",
    });
    expect(request.input).not.toHaveProperty("file");
  });
  it("rejects missing authorization, source substitution and mixed sources", async () => {
    for (const invalid of [
      { ...job, config: { ...job.config, downloadUpload: undefined } },
      { ...job, config: { ...job.config, taskId: "" } },
      { ...job, input: { ...job.input, downloadId: "another-download" } },
      { ...job, input: { ...job.input, sourceScopeId: "another-account" } },
      { ...job, input: { ...job.input, attachmentId: "attachment" } },
    ])
      await expect(browserDeviceRequest(invalid)).rejects.toThrow("invalid_task_download");
  });
});

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
    expect(
      deviceWorkflowErrorCode(new Error("runtime error: failed to send message to the webview")),
    ).toBe("browser_webview_unavailable");
    expect(
      deviceWorkflowErrorCode(
        new Error(
          "Allow dev1 in System Settings → Privacy & Security → Accessibility to control the desktop, then retry.",
        ),
      ),
    ).toBe("desktop_accessibility_required");
    expect(
      deviceWorkflowErrorCode(
        new Error(
          "Allow dev1 in System Settings → Privacy & Security → Screen Recording, then retry.",
        ),
      ),
    ).toBe("desktop_screen_recording_required");
    expect(deviceWorkflowErrorCode(new Error("unsupported_content:image/png"))).toBe(
      "unsupported_content",
    );
    expect(deviceWorkflowErrorCode(new Error("device_node_timeout"))).toBe("device_timeout");
  });

  it("binds browser jobs to their run context, scope, and agent", () => {
    expect(
      browserAgentExecutionRequest({
        id: "job",
        runId: "run",
        nodeId: "node",
        scopeId: "browser-tab-1",
        operation: "browser.inspect",
        contextId: "context-1",
        attempt: 1,
        input: { scopeId: "browser-tab-1" },
        config: { agentId: "agent-1" },
      }),
    ).toMatchObject({
      scopeId: "browser-tab-1",
      grantId: "context-1:job",
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

it("bounds work by the acknowledged lease and refuses expired or revoked jobs", () => {
  const job = {
    id: "job",
    runId: "run",
    nodeId: "node",
    scopeId: "scope",
    operation: "browser.inspect",
    attempt: 1,
    input: {},
    config: {},
    controlVersion: 2,
    deadlineAt: new Date(Date.now() + 60000).toISOString(),
  };
  expect(
    deviceExecutionRemaining(job, new Date(Date.now() + 10000).toISOString()),
  ).toBeLessThanOrEqual(10000);
  expect(() => deviceExecutionRemaining(job, new Date(Date.now() - 1).toISOString())).toThrow(
    "expired",
  );
  expect(() =>
    deviceExecutionRemaining(
      { ...job, cancelRequestedAt: new Date().toISOString() },
      job.deadlineAt,
    ),
  ).toThrow("stopped");
});

it("keeps native pre-dispatch stale frames recoverable without classifying uncertain failures", () => {
  expect(isBrowserSnapshotStale("browser_snapshot_stale: inspect before acting")).toBe(true);
  expect(isBrowserSnapshotStale(new Error("browser_snapshot_stale: foreground changed"))).toBe(
    true,
  );
  expect(isBrowserSnapshotStale("device_execution_uncertain:browser_snapshot_stale")).toBe(false);
  expect(isBrowserSnapshotStale(new Error("Desktop control stopped. You have control."))).toBe(
    false,
  );
});
