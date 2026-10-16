import { beforeEach, expect, it, vi } from "vitest";

const invoke = vi.fn();
const openBrowserView = vi.fn(() => ({ id: "view-new" }));
const saveBookmark = vi.fn(() => "bookmark:new");
const readSharedFile = vi.fn();
const uploadLibraryBlob = vi.fn();
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
vi.mock("@/native/devices", () => ({
  devicesNative: { readSharedFile: (...args: unknown[]) => readSharedFile(...args) },
}));
vi.mock("@/api/spaces/library-upload", () => ({
  uploadLibraryBlob: (...args: unknown[]) => uploadLibraryBlob(...args),
}));
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
const job = (operation: string, input: unknown, scopeId = "scope_reports", spaceId?: string) =>
  ({
    id: "j",
    runId: "r",
    nodeId: "n",
    scopeId,
    spaceId,
    operation,
    attempt: 1,
    input,
    config: {},
  }) as never;
const signal = new AbortController().signal;

beforeEach(() => vi.clearAllMocks());

it("lists only shared, non-private browser tabs once each", async () => {
  expect(await runDeviceAgentOperation(job("browser.tab.list", {}), signal)).toEqual({
    tabs: [{ id: "a", title: "Docs", url: "https://docs.example.com" }],
  });
});

it("opens and bookmarks only web addresses", async () => {
  await runDeviceAgentOperation(job("browser.tab.open", { url: "https://misty.app" }), signal);
  expect(openBrowserView).toHaveBeenCalledWith({ url: "https://misty.app" });
  await expect(
    runDeviceAgentOperation(job("browser.tab.open", { url: "file:///etc/passwd" }), signal),
  ).rejects.toThrow("invalid_url");
  await runDeviceAgentOperation(
    job("bookmark.add", { url: "https://misty.app", title: "Misty" }),
    signal,
  );
  expect(saveBookmark).toHaveBeenCalledWith({ url: "https://misty.app", title: "Misty" });
});

it("searches bookmarks by title or address", async () => {
  expect(await runDeviceAgentOperation(job("bookmark.list", { query: "docs" }), signal)).toEqual({
    bookmarks: [{ id: "b1", title: "Misty docs", url: "https://misty.app/docs" }],
  });
});

it("keeps folder jobs inside the granted folder", async () => {
  invoke.mockResolvedValue({ entries: [] });
  await runDeviceAgentOperation(
    job("folder.list", { scopeId: "scope_reports", relativePath: "Q3" }),
    signal,
  );
  expect(invoke).toHaveBeenCalledWith("agents_list_scoped_files", {
    request: { scopeId: "scope_reports", relativePath: "Q3" },
  });
  await expect(
    runDeviceAgentOperation(
      job("folder.list", { scopeId: "scope_other", relativePath: "" }),
      signal,
    ),
  ).rejects.toThrow("invalid_device_scope");
  await expect(
    runDeviceAgentOperation(
      job("folder.read", { scopeId: "scope_reports", relativePath: "../x" }),
      signal,
    ),
  ).rejects.toThrow("invalid_device_scope");
  expect(
    await runDeviceAgentOperation(
      job("folder.read", { scopeId: "scope_reports", relativePath: "q3.txt" }),
      signal,
    ),
  ).toMatchObject({ name: "q3.txt", text: "Revenue grew" });
});

it("sends a shared file to the conversation's Space Library", async () => {
  const input = { scopeId: "scope_reports", relativePath: "Q3/report.pdf" };
  readSharedFile.mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);
  uploadLibraryBlob.mockResolvedValue({ item: { id: "item_1" } });
  expect(
    await runDeviceAgentOperation(job("folder.send", input, "scope_reports", "space_1"), signal),
  ).toEqual({ name: "report.pdf", size: 3, libraryItemId: "item_1" });
  expect(readSharedFile).toHaveBeenCalledWith("scope_reports", input, {});
  expect(uploadLibraryBlob).toHaveBeenCalledWith("space_1", expect.any(Blob), "report.pdf");
});

it("needs a Space to send a file to", async () => {
  await expect(
    runDeviceAgentOperation(
      job("folder.send", { scopeId: "scope_reports", relativePath: "report.pdf" }),
      signal,
    ),
  ).rejects.toThrow("no_space");
  expect(readSharedFile).not.toHaveBeenCalled();
});
