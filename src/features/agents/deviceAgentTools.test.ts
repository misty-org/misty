import { beforeEach, expect, it, vi } from "vitest";

const invoke = vi.fn();
const openBrowserView = vi.fn(() => ({ id: "view-new" }));
const saveBookmark = vi.fn(() => "bookmark:new");
const views = [
  { id: "a", surfaceId: "browser", title: "Docs", state: { url: "https://docs.example.com" } },
  { id: "a", surfaceId: "browser", title: "Docs", state: { url: "https://docs.example.com" } },
  {
    id: "p",
    surfaceId: "browser",
    title: "Secret",
    state: { url: "https://bank.example", private: true },
  },
  { id: "n", surfaceId: "notes", title: "Notes", state: {} },
];
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
vi.mock("./store/useAgentsStore", () => ({
  agentsPrepareScopedDocument: vi.fn(async () => ({
    displayName: "q3.txt",
    mimeType: "text/plain",
    truncated: false,
    sections: [{ kind: "text", locator: "1", text: "Revenue grew" }],
  })),
}));
vi.mock("@/features/workspace/windows", () => ({
  mapAllWorkspaceWindowViews: (_state: unknown, visit: (view: (typeof views)[number]) => unknown) =>
    views.forEach(visit),
}));
vi.mock("@/features/workspace", () => ({
  useWorkspaceStore: {
    getState: () => ({
      openBrowserView,
      bookmarks: [
        {
          id: "b1",
          fields: { folder_id: "f", title: "Misty docs", url: "https://misty.app/docs", order: 0 },
        },
        {
          id: "b2",
          fields: { folder_id: "f", title: "News", url: "https://news.example", order: 1 },
        },
      ],
    }),
  },
  isPrivateBrowserView: (view: { state: { private?: boolean } }) => Boolean(view.state.private),
  parseBrowserViewState: (state: { url: string }) => state,
}));
vi.mock("@/features/bookmarks/library", () => ({
  bookmarks: (records: Array<{ id: string; fields: { title: string; url: string } }>) =>
    records.map((record) => ({ id: record.id, ...record.fields })),
  bookmarkUrl: (value: string) => {
    if (!/^https?:\/\//.test(value)) throw new Error("bad");
    return value;
  },
  saveBookmark: (...args: unknown[]) => saveBookmark(...(args as [])),
}));

const { runDeviceAgentOperation } = await import("./deviceAgentTools");
const job = (operation: string, input: unknown, scopeId = "scope_reports") =>
  ({
    id: "j",
    runId: "r",
    nodeId: "n",
    scopeId,
    operation,
    attempt: 1,
    input,
    config: {},
  }) as never;
const signal = new AbortController().signal;

beforeEach(() => vi.clearAllMocks());

it("lists only shared, non-private browser tabs once each", async () => {
  expect(await runDeviceAgentOperation(job("tabs.list", {}), signal)).toEqual({
    tabs: [{ id: "a", title: "Docs", url: "https://docs.example.com" }],
  });
});

it("opens and bookmarks only web addresses", async () => {
  await runDeviceAgentOperation(job("tabs.open", { url: "https://misty.app" }), signal);
  expect(openBrowserView).toHaveBeenCalledWith({ url: "https://misty.app" });
  await expect(
    runDeviceAgentOperation(job("tabs.open", { url: "file:///etc/passwd" }), signal),
  ).rejects.toThrow("invalid_url");
  await runDeviceAgentOperation(
    job("bookmarks.add", { url: "https://misty.app", title: "Misty" }),
    signal,
  );
  expect(saveBookmark).toHaveBeenCalledWith({ url: "https://misty.app", title: "Misty" });
});

it("searches bookmarks by title or address", async () => {
  expect(await runDeviceAgentOperation(job("bookmarks.list", { query: "docs" }), signal)).toEqual({
    bookmarks: [{ id: "b1", title: "Misty docs", url: "https://misty.app/docs" }],
  });
});

it("keeps folder jobs inside the granted folder", async () => {
  invoke.mockResolvedValue({ entries: [] });
  await runDeviceAgentOperation(
    job("files.list", { scopeId: "scope_reports", relativePath: "Q3" }),
    signal,
  );
  expect(invoke).toHaveBeenCalledWith("agents_list_scoped_files", {
    request: { scopeId: "scope_reports", relativePath: "Q3" },
  });
  await expect(
    runDeviceAgentOperation(
      job("files.list", { scopeId: "scope_other", relativePath: "" }),
      signal,
    ),
  ).rejects.toThrow("invalid_device_scope");
  await expect(
    runDeviceAgentOperation(
      job("files.read", { scopeId: "scope_reports", relativePath: "../x" }),
      signal,
    ),
  ).rejects.toThrow("invalid_device_scope");
  expect(
    await runDeviceAgentOperation(
      job("files.read", { scopeId: "scope_reports", relativePath: "q3.txt" }),
      signal,
    ),
  ).toMatchObject({ name: "q3.txt", text: "Revenue grew" });
});
