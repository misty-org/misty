import { beforeEach, expect, it, vi } from "vitest";

const invoke = vi.fn();
const openBrowserView = vi.fn(() => ({ id: "view-new" }));
const focusView = vi.fn();
const views = [
  { id: "open", surfaceId: "browser", state: { url: "http://127.0.0.1:5501/" } },
  { id: "n", surfaceId: "notes", state: {} },
];
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
vi.mock("@/features/workspace/windows", () => ({
  mapAllWorkspaceWindowViews: (_state: unknown, visit: (view: (typeof views)[number]) => unknown) =>
    views.forEach(visit),
}));
vi.mock("@/features/workspace", () => ({
  useWorkspaceStore: { getState: () => ({ openBrowserView, focusView }) },
  parseBrowserViewState: (state: { url?: string }) => ({ url: state.url ?? "" }),
}));

import { codeProjectOperations, runCodeProjectOperation } from "./codeProjectTools";

const job = (operation: string, input: unknown = {}) => ({
  id: "job_1",
  runId: "invocation_1",
  nodeId: "node",
  scopeId: "scope_site",
  operation,
  attempt: 1,
  input,
  config: { runGrant: { payload: "p", signature: "s" } },
});

beforeEach(() => {
  invoke.mockReset();
  openBrowserView.mockClear();
  focusView.mockClear();
});

it("forwards the job, grant included, to the native sandbox", async () => {
  invoke.mockResolvedValue({ exitCode: 0, output: "ok" });
  const result = await runCodeProjectOperation(
    job("code.run", { command: "npm run build" }),
    new AbortController().signal,
  );
  expect(result).toEqual({ exitCode: 0, output: "ok" });
  expect(invoke).toHaveBeenCalledWith("code_execute", {
    request: {
      operation: "code.run",
      scopeId: "scope_site",
      runId: "invocation_1",
      input: { command: "npm run build" },
      config: { runGrant: { payload: "p", signature: "s" } },
    },
  });
  expect(openBrowserView).not.toHaveBeenCalled();
});

it("opens Misty's own preview address in a tab, reusing an open one", async () => {
  invoke.mockResolvedValueOnce({ url: "http://127.0.0.1:5500/about.html" });
  const opened = await runCodeProjectOperation(job("code.preview"), new AbortController().signal);
  expect(openBrowserView).toHaveBeenCalledWith({ url: "http://127.0.0.1:5500/about.html" });
  expect(opened).toMatchObject({ opened: true, tabId: "view-new" });

  invoke.mockResolvedValueOnce({ url: "http://127.0.0.1:5501/" });
  const reused = await runCodeProjectOperation(job("code.preview"), new AbortController().signal);
  expect(focusView).toHaveBeenCalledWith("open");
  expect(openBrowserView).toHaveBeenCalledTimes(1);
  expect(reused).toMatchObject({ tabId: "open" });
});

it("never opens an address that isn't Misty's loopback preview", async () => {
  for (const url of [
    "https://evil.example/",
    "http://192.168.1.5:80/",
    "file:///etc/passwd",
    "javascript:alert(1)",
  ]) {
    invoke.mockResolvedValueOnce({ url });
    const result = await runCodeProjectOperation(job("code.preview"), new AbortController().signal);
    expect(result.opened).toBeUndefined();
  }
  expect(openBrowserView).not.toHaveBeenCalled();
});

it("covers exactly the code tools", () => {
  expect([...codeProjectOperations].every((name) => name.startsWith("code."))).toBe(true);
  expect(codeProjectOperations.size).toBe(12);
});
