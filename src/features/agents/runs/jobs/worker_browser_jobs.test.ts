import { expect, it, vi } from "vitest";
import {
  browserAgentExecutionRequest,
  browserDeviceRequest,
  jobPolicyCall,
} from "./worker_browser_jobs";

it("passes the tool call to native code, and no policy of its own", () => {
  expect(jobPolicyCall({ policyCall: "call-1" })).toBe("call-1");
  expect(jobPolicyCall({ policyCall: 3 })).toBeUndefined();
  expect(jobPolicyCall(null)).toBeUndefined();
  const request = browserAgentExecutionRequest({
    id: "job-1",
    runId: "run",
    nodeId: "n",
    scopeId: "scope-1",
    operation: "browser.steps",
    contextId: "ctx",
    attempt: 1,
    input: { steps: [] },
    config: {
      agentId: "agent",
      taskId: "task",
      policyCall: "call-1",
      siteBlocks: { sensitive: false, sites: [] },
      confirmKinds: [],
      grantSet: { mode: "auto", grants: [] },
    },
  });
  expect(request.policyCall).toBe("call-1");
  for (const field of ["siteBlocks", "confirmKinds", "grantSet"]) {
    expect(request).not.toHaveProperty(field);
    expect(request.input).not.toHaveProperty(field);
  }
});

const files = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: files.read }));

const uploadJob = (input: Record<string, unknown>, config: Record<string, unknown>) => ({
  id: "job-2",
  runId: "run",
  nodeId: "n",
  scopeId: "scope-1",
  operation: "browser.upload",
  contextId: "ctx",
  attempt: 1,
  input,
  config: { agentId: "agent", taskId: "task", ...config },
});

it("hands a file from the run's working folder to the page", async () => {
  files.read.mockResolvedValueOnce([{ name: "report.pdf", data: btoa("pdf!") }]);
  const request = await browserDeviceRequest(
    uploadJob(
      { scopeId: "scope-1", documentId: "doc-12345", ref: "e4", path: "out/report.pdf" },
      { workingFile: { runId: "run", path: "out/report.pdf" } },
    ),
  );
  expect(files.read).toHaveBeenCalledWith("space_app_agent_files", {
    runId: "run",
    paths: ["out/report.pdf"],
  });
  expect(request.input).not.toHaveProperty("path");
  expect((request.input as { file?: unknown }).file).toEqual({
    name: "report.pdf",
    mimeType: "application/pdf",
    byteSize: 4,
    base64: btoa("pdf!"),
  });
});

it("refuses a working file from another run or a mixed source", async () => {
  for (const [input, config] of [
    [{ ref: "e4", path: "a.txt" }, { workingFile: { runId: "other", path: "a.txt" } }],
    [{ ref: "e4", path: "a.txt" }, { workingFile: { runId: "run", path: "b.txt" } }],
    [
      { ref: "e4", path: "a.txt", attachmentId: "x" },
      { workingFile: { runId: "run", path: "a.txt" } },
    ],
  ] as const) {
    await expect(browserDeviceRequest(uploadJob({ ...input }, { ...config }))).rejects.toThrow(
      "invalid_task_file",
    );
  }
});
