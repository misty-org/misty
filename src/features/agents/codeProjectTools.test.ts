import { beforeEach, expect, it, vi } from "vitest";

const invoke = vi.fn();
const openBrowserView = vi.fn(() => ({ id: "view-new" }));
const focusView = vi.fn();
const views = [
  { id: "open", surfaceId: "browser", state: { url: "http://127.0.0.1:5501/" } },
  { id: "n", surfaceId: "notes", state: {} },
];
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
const push = vi.fn(async () => ({ branch: "feature", sha: "c2", commits: 1, upToDate: false }));
vi.mock("./git/gitSync", () => ({
  push: () => push(),
  pull: vi.fn(),
  openPullRequest: vi.fn(),
}));
vi.mock("./git/projectGit", () => ({
  projectGit: vi.fn(() => ({})),
  commitAuthor: vi.fn(async () => ({
    name: "Matt",
    email: "1+kannachi323@users.noreply.github.com",
  })),
}));
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
  push.mockClear();
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

it("covers exactly the code and Git tools", () => {
  expect([...codeProjectOperations].every((name) => /^(code|git)\./.test(name))).toBe(true);
  expect(codeProjectOperations.size).toBe(20);
});

it("commits as the person's account, whatever the agent sent", async () => {
  invoke.mockResolvedValue({ sha: "c1" });
  await runCodeProjectOperation(
    job("git.commit", { message: "Add page", author: { name: "Agent", email: "x@evil.example" } }),
    new AbortController().signal,
  );
  expect(invoke).toHaveBeenCalledWith("code_execute", {
    request: expect.objectContaining({
      operation: "git.commit",
      input: {
        message: "Add page",
        author: { name: "Matt", email: "1+kannachi323@users.noreply.github.com" },
      },
    }),
  });
});

it("pushes only after the native check allows it, and explains a refusal", async () => {
  invoke.mockResolvedValueOnce({ allowed: false, reason: "Agents can't push this project." });
  const refused = await runCodeProjectOperation(job("git.push"), new AbortController().signal);
  expect(refused).toEqual({
    status: "failure",
    tool_error: { message: "Agents can't push this project." },
  });
  expect(push).not.toHaveBeenCalled();
  expect(invoke).toHaveBeenCalledWith("code_git_job", {
    request: {
      operation: "git.push",
      scopeId: "scope_site",
      config: { runGrant: { payload: "p", signature: "s" } },
    },
  });

  invoke.mockResolvedValueOnce({ allowed: true });
  const pushed = await runCodeProjectOperation(job("git.push"), new AbortController().signal);
  expect(pushed).toMatchObject({ branch: "feature", commits: 1 });

  invoke.mockResolvedValueOnce({ allowed: true });
  push.mockRejectedValueOnce(
    new Error("GitHub has commits on feature that this project doesn't. Pull first, then push."),
  );
  const stale = await runCodeProjectOperation(job("git.push"), new AbortController().signal);
  expect(stale).toMatchObject({
    status: "failure",
    tool_error: { message: expect.stringMatching(/Pull first/) },
  });
});
