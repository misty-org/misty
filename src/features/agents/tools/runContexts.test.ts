import { beforeEach, expect, it, vi } from "vitest";
import type { AiInvocationRequest } from "@/features/agents/runs/invocations/invocationTypes";
import {
  browserScopeAllowed,
  browserToolSurface,
  contextFor,
  joinRunTabs,
  loadRunEntry,
  rememberRun,
  scopeTaskId,
  sessionTarget,
  withRunLock,
  type RunEntry,
} from "./runContexts";

const store = vi.hoisted(() => ({ revision: 0, state: null as unknown, conflicts: 0 }));
vi.mock("@/shared/platform/nativeInvoke", () => ({
  invoke: async (command: string, args: { revision: number; document: unknown }) => {
    if (command === "settings_session_state")
      return { revision: store.revision, state: store.state };
    if (store.conflicts > 0) {
      store.conflicts--;
      store.revision++;
      throw new Error("SETTINGS_REVISION_CONFLICT");
    }
    if (args.revision !== store.revision) throw new Error("SETTINGS_REVISION_CONFLICT");
    store.revision++;
    store.state = args.document;
    return {};
  },
}));

const request = (over: Partial<AiInvocationRequest> = {}) =>
  ({
    agentId: "agent",
    windowLabel: "main",
    taskId: "task",
    permissionMode: "auto",
    collaborationMode: "act",
    executionMode: "agent",
    attachmentIds: ["file-1"],
    attachmentNames: { "file-1": "a.pdf" },
    ...over,
  }) as AiInvocationRequest;

const browserTab = {
  deviceId: "device",
  kind: "browser_tab" as const,
  opaqueRef: "tab-scope-1",
  capabilities: ["browser.snapshot"],
  metadata: { app_id: "browser", window_label: "main" },
  runGrant: { payload: "p", signature: "s" },
};

beforeEach(() => {
  store.revision = 0;
  store.state = null;
  store.conflicts = 0;
});

it("carries what the run was sent with", async () => {
  await rememberRun("run", "conversation", request(), [browserTab]);
  const entry = (await loadRunEntry("run")) as RunEntry;
  expect(entry).toMatchObject({
    agentId: "agent",
    taskId: "task",
    windowLabel: "main",
    conversationId: "conversation",
    permissionMode: "auto",
    collaborationMode: "act",
    executionMode: "agent",
    attachments: [{ id: "file-1", name: "a.pdf" }],
  });
  expect(entry.contexts[0]).toMatchObject({
    opaqueRef: "tab-scope-1",
    runGrant: browserTab.runGrant,
  });
});

it("survives anything a window remembers: another read finds it", async () => {
  await rememberRun("run", undefined, request(), []);
  await rememberRun("other", undefined, request(), []);
  expect(await loadRunEntry("run")).not.toBeNull();
  expect(await loadRunEntry("other")).not.toBeNull();
});

it("reads any mode it doesn't know as Ask", async () => {
  await rememberRun("run", undefined, request({ permissionMode: undefined }), []);
  expect((await loadRunEntry("run"))?.permissionMode).toBe("ask");
});

it("retries when another window saved first, keeping both", async () => {
  await rememberRun("first", undefined, request(), []);
  store.conflicts = 2;
  await rememberRun("second", undefined, request(), []);
  expect(await loadRunEntry("first")).not.toBeNull();
  expect(await loadRunEntry("second")).not.toBeNull();
});

it("keeps joined tabs when the same request is sent again", async () => {
  await rememberRun("run", undefined, request(), [browserTab]);
  await joinRunTabs("run", [{ ...browserTab, opaqueRef: "tab-scope-2" }]);
  await rememberRun("run", undefined, request(), [browserTab]);
  const entry = (await loadRunEntry("run")) as RunEntry;
  expect(entry.contexts.map((item) => item.opaqueRef)).toEqual(["tab-scope-1", "tab-scope-2"]);
});

it("forgets runs older than a day", async () => {
  await rememberRun("old", undefined, request(), []);
  const now = Date.now();
  const spy = vi.spyOn(Date, "now").mockReturnValue(now + 25 * 3_600_000);
  await rememberRun("new", undefined, request(), []);
  spy.mockRestore();
  const runs = (store.state as { runs: Record<string, unknown> }).runs;
  expect(Object.keys(runs)).toEqual(["new"]);
});

it("doesn't join a tab to a run it has no record of", async () => {
  await expect(joinRunTabs("nobody", [browserTab])).resolves.toBeNull();
});

it("authorizes the exact target, only for the window that asked", async () => {
  await rememberRun("run", undefined, request(), [
    browserTab,
    { ...browserTab, opaqueRef: "tab-scope-2", metadata: { app_id: "browser", window_label: "b" } },
    { ...browserTab, opaqueRef: "tab-scope-3", metadata: { window_label: "main" } },
  ]);
  const entry = (await loadRunEntry("run")) as RunEntry;
  expect(browserScopeAllowed(entry, "tab-scope-1")).toBe(true);
  expect(browserScopeAllowed(entry, "tab-scope-2")).toBe(false);
  expect(browserScopeAllowed(entry, "tab-scope-3")).toBe(false);
  expect(browserScopeAllowed(entry, "unknown")).toBe(false);
  expect(browserScopeAllowed({ ...entry, agentId: "" }, "unknown")).toBe(true);
});

it("names a job's context only for a capability it holds and while it lasts", async () => {
  await rememberRun("run", undefined, request(), [browserTab]);
  const entry = (await loadRunEntry("run")) as RunEntry;
  expect(contextFor(entry, "tab-scope-1", "browser.snapshot")).toBeTruthy();
  expect(contextFor(entry, "tab-scope-1", "browser.steps")).toBeUndefined();
  const spy = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 7 * 3_600_000);
  expect(contextFor(entry, "tab-scope-1", "browser.snapshot")).toBeUndefined();
  spy.mockRestore();
});

it("finds a scope's surface and task", async () => {
  await rememberRun("run", undefined, request(), [
    { ...browserTab, metadata: { workspace_control: true, desktop_control: true, task_id: "own" } },
    { ...browserTab, opaqueRef: "tab-scope-2", metadata: { workspace_control: true } },
    { ...browserTab, opaqueRef: "tab-scope-3" },
  ]);
  const entry = (await loadRunEntry("run")) as RunEntry;
  expect(browserToolSurface(entry, "tab-scope-1")).toBe("desktop");
  expect(browserToolSurface(entry, "tab-scope-2")).toBe("workspace");
  expect(browserToolSurface(entry, "tab-scope-3")).toBe("browser");
  expect(scopeTaskId(entry, "tab-scope-1")).toBe("own");
  expect(scopeTaskId(entry, "tab-scope-3")).toBe("task");
});

it("opens sessions only under this computer's own workspace grant", async () => {
  const workspace = {
    deviceId: "device",
    kind: "workspace" as const,
    opaqueRef: "workspace:device",
    capabilities: ["browser.session"],
  };
  await rememberRun("run", undefined, request(), [workspace]);
  expect(sessionTarget((await loadRunEntry("run")) as RunEntry)).toBeUndefined();
  await rememberRun("run", undefined, request(), [
    { ...workspace, metadata: { source: "desktop" } },
  ]);
  expect(sessionTarget((await loadRunEntry("run")) as RunEntry)?.opaqueRef).toBe(
    "workspace:device",
  );
});

it("takes calls in turn, and one that fails doesn't stop the next", async () => {
  const order: string[] = [];
  let release = () => {};
  const first = withRunLock("run", async () => {
    await new Promise<void>((done) => {
      release = done;
    });
    order.push("first");
    throw new Error("no");
  });
  const second = withRunLock("run", async () => {
    order.push("second");
  });
  await vi.waitFor(() => expect(release).not.toBe(undefined));
  await Promise.resolve();
  release();
  await expect(first).rejects.toThrow("no");
  await second;
  expect(order).toEqual(["first", "second"]);
});
