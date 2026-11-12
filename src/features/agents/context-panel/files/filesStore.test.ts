// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DirEntry } from "./filesApi";

const mocks = vi.hoisted(() => ({
  listDir: vi.fn(),
  readFile: vi.fn(async () => ({ kind: "text", text: "", dataUrl: null, truncated: false })),
  writeFile: vi.fn(),
  gitTreeStatus: vi.fn(),
}));
vi.mock("./filesApi", () => ({ filesApi: mocks }));
vi.mock("./fileIndex", () => ({ useFileIndex: { getState: () => ({ invalidate: () => {} }) } }));
vi.mock("./treePreferences", async () => {
  const { create } = await import("zustand");
  return { useTreePreferences: create(() => ({ hideIgnored: false })) };
});

import { tabsKey, treeKey, useFilesStore } from "./filesStore";
import { useTreePreferences } from "./treePreferences";
import { buildVisibleNodes } from "./visibleNodes";

const entry = (name: string, isDir = false): DirEntry => ({ name, isDir, size: 0, mtimeMs: 0 });
const emptyStatus = () => ({ repositories: [], fileColors: {} });

describe("single-child folder chains and remembered expansion", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.gitTreeStatus.mockResolvedValue(emptyStatus());
    useTreePreferences.setState({ hideIgnored: false });
    useFilesStore.setState({
      root: "/chain",
      children: { "/chain": [entry("src", true)] },
      expanded: { "/chain": true },
      loadingDirs: {},
      dirErrors: {},
      repositories: {},
      fileColors: {},
    });
    localStorage.removeItem(treeKey("/chain"));
  });

  it("one click reads down a chain of only children to the folder that holds files", async () => {
    mocks.listDir.mockImplementation(
      async (path: string) =>
        ({
          "/chain/src": [entry("main", true)],
          "/chain/src/main": [entry("java", true)],
          "/chain/src/main/java": [entry("App.java")],
        })[path] ?? [],
    );
    await useFilesStore.getState().toggleCompactDir(["/chain/src"]);
    expect(mocks.listDir.mock.calls.map(([path]) => path)).toEqual([
      "/chain/src",
      "/chain/src/main",
      "/chain/src/main/java",
    ]);
    expect(useFilesStore.getState().expanded).toMatchObject({
      "/chain/src": true,
      "/chain/src/main": true,
      "/chain/src/main/java": true,
    });
    expect(useFilesStore.getState().children["/chain/src/main/java"]).toEqual([entry("App.java")]);
  });

  it("a folder collapsed while reading doesn't open a child that arrives late", async () => {
    let finish!: (entries: DirEntry[]) => void;
    mocks.listDir.mockReturnValue(
      new Promise<DirEntry[]>((resolve) => {
        finish = resolve;
      }),
    );
    const click = useFilesStore.getState().toggleCompactDir(["/chain/src"]);
    await useFilesStore.getState().toggleDir("/chain/src");
    finish([entry("main", true)]);
    await click;
    expect(useFilesStore.getState().expanded["/chain/src/main"]).toBeUndefined();
    expect(mocks.listDir).toHaveBeenCalledTimes(1);
  });

  it("while ignored entries are hidden, chains and expand-all skip them", async () => {
    useTreePreferences.setState({ hideIgnored: true });
    useFilesStore.setState({
      children: {
        "/chain": [entry("src", true), { ...entry("cache", true), ignored: true }],
        "/chain/src": [{ ...entry("ignored", true), ignored: true }, entry("Main.java")],
        "/chain/cache": [],
      },
    });
    await useFilesStore.getState().toggleCompactDir(["/chain/src"]);
    expect(useFilesStore.getState().expanded["/chain/src/ignored"]).toBeUndefined();
    useFilesStore.getState().expandLoadedDirs();
    expect(useFilesStore.getState().expanded["/chain/cache"]).toBeUndefined();
    expect(mocks.listDir).not.toHaveBeenCalled();
  });

  it("collapsing a parent forgets its descendants, and only reachable folders are kept", async () => {
    useFilesStore.setState({
      expanded: { "/chain": true, "/chain/src": true, "/chain/src/main": true },
    });
    await useFilesStore.getState().toggleDir("/chain/src");
    expect(useFilesStore.getState().expanded).toEqual({ "/chain": true });
    expect(JSON.parse(localStorage.getItem(treeKey("/chain"))!)).toEqual({ expanded: ["/chain"] });
  });

  it("each folder restores its own expansion after switching", () => {
    mocks.listDir.mockResolvedValue([]);
    useFilesStore.setState({ expanded: { "/chain": true, "/chain/src": true } });
    useFilesStore.getState().setRoot("/other");
    expect(useFilesStore.getState().expanded).toEqual({ "/other": true });
    useFilesStore.getState().setRoot("/chain");
    expect(useFilesStore.getState().expanded).toEqual({ "/chain": true, "/chain/src": true });
    expect(JSON.parse(localStorage.getItem(treeKey("/chain"))!)).toEqual({
      expanded: ["/chain", "/chain/src"],
    });
  });

  it("a chain ending at a nested repository still opens into it in one click", async () => {
    mocks.listDir.mockImplementation(
      async (path: string) =>
        ({
          "/chain/src": [entry("repo", true)],
          "/chain/src/repo": [entry("index.ts")],
        })[path] ?? [],
    );
    mocks.gitTreeStatus.mockImplementation(async (requests: { path: string }[]) => ({
      repositories: requests.some((request) => request.path === "/chain/src")
        ? [{ path: "/chain/src/repo", branch: "main", changed: 0, untracked: 0 }]
        : [],
      fileColors: {},
    }));
    await useFilesStore.getState().toggleCompactDir(["/chain/src"]);
    expect(mocks.listDir.mock.calls.map(([path]) => path)).toEqual([
      "/chain/src",
      "/chain/src/repo",
    ]);
    const row = buildVisibleNodes({ ...useFilesStore.getState(), hideIgnored: false })[1];
    expect(row).toMatchObject({ name: "src/repo", path: "/chain/src/repo", expanded: true });
  });

  it("a chain stops where the Git-ignore state changes", async () => {
    mocks.listDir.mockImplementation(
      async (path: string) =>
        ({
          "/chain/src": [{ ...entry("gen", true), ignored: true }],
          "/chain/src/gen": [{ ...entry("out.ts"), ignored: true }],
        })[path] ?? [],
    );
    await useFilesStore.getState().toggleCompactDir(["/chain/src"]);
    expect(mocks.listDir.mock.calls.map(([path]) => path)).toEqual(["/chain/src"]);
    expect(useFilesStore.getState().expanded["/chain/src/gen"]).toBeUndefined();
  });

  it("the root row opens one level only", async () => {
    useFilesStore.setState({ expanded: {} });
    // A finite listing: a regression then fails instead of looping forever.
    mocks.listDir.mockImplementation(
      async (path: string) => ({ "/chain/src": [entry("App.ts")] })[path] ?? [],
    );
    await useFilesStore.getState().toggleCompactDir(["/chain"]);
    expect(useFilesStore.getState().expanded).toEqual({ "/chain": true });
    expect(mocks.listDir).not.toHaveBeenCalled();
  });

  it("making something inside a collapsed merged row opens every folder of that row", async () => {
    useFilesStore.setState({
      children: {
        "/chain": [entry("a", true)],
        "/chain/a": [entry("b", true)],
        "/chain/a/b": [entry("c", true)],
        "/chain/a/b/c": [entry("created.ts")],
      },
    });
    await useFilesStore.getState().revealDir("/chain/a/b/c");
    expect(mocks.listDir).not.toHaveBeenCalled();
    const row = buildVisibleNodes({ ...useFilesStore.getState(), hideIgnored: false })[1];
    expect(row).toMatchObject({ name: "a/b/c", expanded: true });
    expect(JSON.parse(localStorage.getItem(treeKey("/chain"))!).expanded).toContain("/chain/a/b/c");
  });

  it("expanding loaded folders keeps open folders still reading", () => {
    useFilesStore.setState({
      children: { "/chain": [entry("src", true), entry("slow", true)], "/chain/src": [] },
      expanded: { "/chain": true, "/chain/slow": true },
      loadingDirs: { "/chain/slow": true },
    });
    useFilesStore.getState().expandLoadedDirs();
    expect(useFilesStore.getState().expanded).toEqual({
      "/chain": true,
      "/chain/src": true,
      "/chain/slow": true,
    });
  });

  it("a refresh reads collapsed loaded folders again, so reopening never shows old entries", async () => {
    useFilesStore.setState({
      children: { "/chain": [entry("src", true)], "/chain/src": [entry("old.ts")] },
    });
    mocks.listDir.mockImplementation(
      async (path: string) =>
        ({
          "/chain": [entry("src", true)],
          "/chain/src": [entry("new.ts")],
        })[path] ?? [],
    );
    await useFilesStore.getState().refreshTree();
    expect(mocks.listDir.mock.calls.map(([path]) => path).sort()).toEqual(["/chain", "/chain/src"]);
    await useFilesStore.getState().toggleCompactDir(["/chain/src"]);
    expect(useFilesStore.getState().children["/chain/src"]).toEqual([entry("new.ts")]);
  });

  it("a refresh drops folders their parent no longer lists, and leaves them out of Git colors", async () => {
    useFilesStore.setState({
      children: {
        "/chain": [entry("src", true), entry("gone", true)],
        "/chain/src": [],
        "/chain/gone": [entry("old.ts")],
      },
      expanded: { "/chain": true, "/chain/gone": true },
    });
    mocks.listDir.mockImplementation(async (path: string) => {
      if (path === "/chain/gone") throw new Error("not found");
      return ({ "/chain": [entry("src", true)] } as Record<string, DirEntry[]>)[path] ?? [];
    });
    await useFilesStore.getState().refreshTree();
    expect(useFilesStore.getState().children["/chain/gone"]).toBeUndefined();
    expect(
      mocks.gitTreeStatus.mock.calls[0][0].map((request: { path: string }) => request.path).sort(),
    ).toEqual(["/chain", "/chain/src"]);
  });

  it("a refresh retries an open folder that failed to read", async () => {
    useFilesStore.setState({
      children: { "/chain": [entry("src", true)] },
      expanded: { "/chain": true, "/chain/src": true },
      dirErrors: { "/chain/src": "denied" },
    });
    mocks.listDir.mockImplementation(
      async (path: string) =>
        ({
          "/chain": [entry("src", true)],
          "/chain/src": [entry("Main.java")],
        })[path] ?? [],
    );
    await useFilesStore.getState().refreshTree();
    expect(mocks.listDir.mock.calls.map(([path]) => path).sort()).toEqual(["/chain", "/chain/src"]);
    expect(useFilesStore.getState().dirErrors["/chain/src"]).toBeUndefined();
    expect(useFilesStore.getState().children["/chain/src"]).toEqual([entry("Main.java")]);
  });

  it("a chain still opens to its end when a refresh supersedes the click's first read", async () => {
    const pending: Array<(entries: DirEntry[]) => void> = [];
    const listings: Record<string, DirEntry[]> = {
      "/chain": [entry("src", true)],
      "/chain/src": [entry("main", true)],
      "/chain/src/main": [entry("App.java")],
    };
    let srcCalls = 0;
    mocks.listDir.mockImplementation((path: string) => {
      if (path === "/chain/src" && srcCalls++ < 2)
        return new Promise<DirEntry[]>((resolve) => pending.push(resolve));
      return Promise.resolve(listings[path] ?? []);
    });
    const click = useFilesStore.getState().toggleCompactDir(["/chain/src"]);
    const refresh = useFilesStore.getState().refreshTree();
    // The click's own listing lands first, already superseded by the refresh.
    pending[0]([entry("main", true)]);
    await click;
    pending[1]([entry("main", true)]);
    await refresh;
    expect(useFilesStore.getState().expanded).toMatchObject({
      "/chain/src": true,
      "/chain/src/main": true,
    });
    expect(useFilesStore.getState().children["/chain/src/main"]).toEqual([entry("App.java")]);
  });

  it("a folder name holding a backslash (macOS and Linux) keeps one Git-ignore state for click and row", async () => {
    useFilesStore.setState({
      children: {
        "/chain": [{ ...entry("x\\y", true), ignored: true }],
        "/chain/x\\y": [{ ...entry("gen", true), ignored: true }],
        "/chain/x\\y/gen": [{ ...entry("out.ts"), ignored: true }],
      },
    });
    await useFilesStore.getState().toggleCompactDir(["/chain/x\\y"]);
    const row = buildVisibleNodes({ ...useFilesStore.getState(), hideIgnored: false })[1];
    expect(row).toMatchObject({ name: "x\\y/gen", expanded: true });
  });

  it("a drive root as the folder still remembers its expansion", () => {
    useFilesStore.setState({
      root: "C:\\",
      children: {},
      expanded: { "C:\\": true, "C:\\src": true, "C:\\src/app": true, "C:\\gone/x": true },
    });
    expect(JSON.parse(localStorage.getItem(treeKey("C:\\"))!)).toEqual({
      expanded: ["C:\\", "C:\\src", "C:\\src/app"],
    });
    localStorage.removeItem(treeKey("C:\\"));
  });

  it("a refresh doesn't read folders the Git-ignore switch hides", async () => {
    useTreePreferences.setState({ hideIgnored: true });
    useFilesStore.setState({
      children: { "/chain": [{ ...entry("cache", true), ignored: true }], "/chain/cache": [] },
      expanded: { "/chain": true, "/chain/cache": true },
    });
    mocks.listDir.mockResolvedValue([]);
    await useFilesStore.getState().refreshTree();
    expect(mocks.listDir.mock.calls.map(([path]) => path)).toEqual(["/chain"]);
    // The hidden level is dropped instead of kept stale; it loads fresh
    // once the switch shows it again.
    expect(useFilesStore.getState().children["/chain/cache"]).toBeUndefined();
  });
});

describe("file tree Git refresh", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.resetAllMocks();
    mocks.listDir.mockResolvedValue([entry("file.txt")]);
    mocks.gitTreeStatus.mockResolvedValue(emptyStatus());
    // `sub` was loaded and then collapsed: a refresh still re-reads it, so
    // reopening it (or a Git action's refresh) never shows an old listing.
    useFilesStore.setState({
      root: "/repo",
      children: { "/repo": [entry("sub", true)], "/repo/sub": [] },
      expanded: { "/repo": true },
      loadingDirs: {},
      dirErrors: {},
      repositories: {},
      fileColors: {},
      refreshing: false,
    });
  });

  it("batches all loaded levels instead of requesting a scan per directory", async () => {
    // The root keeps listing `sub`; a level its parent no longer lists is
    // dropped rather than refreshed.
    mocks.listDir.mockImplementation(async (path: string) =>
      path === "/repo" ? [entry("sub", true)] : [entry("file.txt")],
    );
    await useFilesStore.getState().refreshTree();
    expect(mocks.gitTreeStatus).toHaveBeenCalledTimes(1);
    expect(mocks.gitTreeStatus).toHaveBeenCalledWith([
      { path: "/repo", files: ["sub"], directories: ["sub"] },
      { path: "/repo/sub", files: ["file.txt"], directories: [] },
    ]);
  });

  it("keeps refreshing true until Git settles and rejects duplicate refreshes", async () => {
    vi.useFakeTimers();
    let finish!: (value: ReturnType<typeof emptyStatus>) => void;
    const pending = new Promise<ReturnType<typeof emptyStatus>>((resolve) => {
      finish = resolve;
    });
    mocks.gitTreeStatus.mockReturnValue(pending);
    const refresh = useFilesStore.getState().refreshTree();
    await vi.advanceTimersByTimeAsync(600);
    expect(useFilesStore.getState().refreshing).toBe(true);
    await useFilesStore.getState().refreshTree();
    expect(mocks.listDir).toHaveBeenCalledTimes(2);
    finish(emptyStatus());
    await refresh;
    expect(useFilesStore.getState().refreshing).toBe(false);
  });

  it("removes obsolete repository badges and colors after a successful refresh", async () => {
    useFilesStore.setState({
      repositories: { "/repo": { path: "/repo", branch: "main", changed: 1, untracked: 0 } },
      fileColors: { "/repo": { "file.txt": "modified" } },
    });
    await useFilesStore.getState().refreshTree();
    expect(useFilesStore.getState().repositories).toEqual({});
    expect(useFilesStore.getState().fileColors["/repo"]).toEqual({});
  });

  it("awaits Git when invalidating a directory and recovers from Git failure", async () => {
    let fail!: (error: Error) => void;
    mocks.gitTreeStatus.mockReturnValue(
      new Promise((_, reject) => {
        fail = reject;
      }),
    );
    let settled = false;
    const refresh = useFilesStore
      .getState()
      .invalidateDir("/repo")
      .then(() => {
        settled = true;
      });
    await vi.waitFor(() => expect(mocks.gitTreeStatus).toHaveBeenCalledTimes(1));
    expect(settled).toBe(false);
    fail(new Error("Git unavailable"));
    await refresh;
    expect(settled).toBe(true);
    expect(useFilesStore.getState().children["/repo"]).toEqual([entry("file.txt")]);
  });

  it("retains cached Git state on failure and allows a fresh retry", async () => {
    useFilesStore.setState({ fileColors: { "/repo": { "file.txt": "modified" } } });
    mocks.gitTreeStatus.mockRejectedValueOnce(new Error("Git unavailable"));
    await useFilesStore.getState().refreshTree();
    expect(useFilesStore.getState().refreshing).toBe(false);
    expect(useFilesStore.getState().fileColors["/repo"]).toEqual({ "file.txt": "modified" });
    await useFilesStore.getState().refreshTree();
    expect(mocks.gitTreeStatus).toHaveBeenCalledTimes(2);
    expect(useFilesStore.getState().fileColors["/repo"]).toEqual({});
  });

  it("discards old Git replies after switching away and back to the same root", async () => {
    let finish!: (value: {
      repositories: [];
      fileColors: Record<string, Record<string, string>>;
    }) => void;
    mocks.gitTreeStatus.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const refresh = useFilesStore.getState().refreshTree();
    await vi.waitFor(() => expect(mocks.gitTreeStatus).toHaveBeenCalledTimes(1));
    useFilesStore.getState().setRoot("");
    useFilesStore.getState().setRoot("/repo");
    await vi.waitFor(() => expect(mocks.gitTreeStatus).toHaveBeenCalledTimes(2));
    finish({ repositories: [], fileColors: { "/repo": { "stale.txt": "modified" } } });
    await refresh;
    expect(useFilesStore.getState().fileColors["/repo"]).toEqual({});
  });
});

/** Listings run off the main thread, so two of one folder can come back out of order: only the newest may write. */
describe("file tree listings of one directory", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.resetAllMocks();
    mocks.gitTreeStatus.mockResolvedValue(emptyStatus());
    useFilesStore.setState({
      root: "/repo",
      children: { "/repo": [entry("old.txt")] },
      expanded: {},
      loadingDirs: {},
      dirErrors: {},
      repositories: {},
      fileColors: {},
      refreshing: false,
    });
  });

  function deferredListing() {
    let resolve!: (entries: DirEntry[]) => void;
    mocks.listDir.mockReturnValueOnce(
      new Promise<DirEntry[]>((r) => {
        resolve = r;
      }),
    );
    return resolve;
  }

  it("asks for Git ignore flags bounded by the tree root", async () => {
    mocks.listDir.mockResolvedValue([entry("a.txt")]);
    await useFilesStore.getState().invalidateDir("/repo");
    expect(mocks.listDir).toHaveBeenCalledWith("/repo", "/repo");
  });

  it("a refresh listing that resolves after a newer invalidate does not overwrite it", async () => {
    const finishRefresh = deferredListing();
    mocks.listDir.mockResolvedValueOnce([entry("renamed.txt")]);
    const refresh = useFilesStore.getState().refreshTree();
    await useFilesStore.getState().invalidateDir("/repo");
    expect(useFilesStore.getState().children["/repo"]).toEqual([entry("renamed.txt")]);

    finishRefresh([entry("before-rename.txt")]);
    await refresh;
    expect(useFilesStore.getState().children["/repo"]).toEqual([entry("renamed.txt")]);
    expect(useFilesStore.getState().refreshing).toBe(false);
  });

  it("a superseded first load still clears its loading flag", async () => {
    useFilesStore.setState({
      children: { "/repo": [entry("sub", true)] },
      expanded: { "/repo": true, "/repo/sub": true },
    });
    const finishLoad = deferredListing();
    mocks.listDir.mockImplementation(async (path: string) =>
      path === "/repo" ? [entry("sub", true)] : [entry("fresh.txt")],
    );
    const load = useFilesStore.getState().ensureDir("/repo/sub");
    await useFilesStore.getState().refreshTree();
    expect(useFilesStore.getState().children["/repo/sub"]).toEqual([entry("fresh.txt")]);

    finishLoad([entry("stale.txt")]);
    await load;
    expect(useFilesStore.getState().children["/repo/sub"]).toEqual([entry("fresh.txt")]);
    expect(useFilesStore.getState().loadingDirs["/repo/sub"]).toBeUndefined();
  });
});

describe("open files as tabs", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.listDir.mockResolvedValue([]);
    mocks.gitTreeStatus.mockResolvedValue(emptyStatus());
    mocks.readFile.mockImplementation(async () => ({
      kind: "text",
      text: "body",
      dataUrl: null,
      truncated: false,
    }));
    localStorage.removeItem(tabsKey("/tabs"));
    localStorage.removeItem(tabsKey("/other"));
    useFilesStore.setState({ root: "" });
    useFilesStore.getState().setRoot("/tabs");
  });

  it("opens a file once and shows its tab again on the next open", async () => {
    await useFilesStore.getState().openFile("/tabs/a.ts");
    await useFilesStore.getState().openFile("/tabs/b.ts");
    await useFilesStore.getState().openFile("/tabs/a.ts");
    expect(useFilesStore.getState().openFiles).toEqual(["/tabs/a.ts", "/tabs/b.ts"]);
    expect(useFilesStore.getState().activeFilePath).toBe("/tabs/a.ts");
    expect(mocks.readFile).toHaveBeenCalledTimes(2);
  });

  it("closing the shown tab shows the one that slid into its place, then the tree", async () => {
    await useFilesStore.getState().openFile("/tabs/a.ts");
    await useFilesStore.getState().openFile("/tabs/b.ts");
    useFilesStore.getState().activateFile("/tabs/a.ts");
    useFilesStore.getState().closeFile("/tabs/a.ts");
    expect(useFilesStore.getState().activeFilePath).toBe("/tabs/b.ts");
    useFilesStore.getState().closeFile("/tabs/b.ts");
    expect(useFilesStore.getState().activeFilePath).toBeNull();
  });

  it("keeps each folder's tabs, and reads a restored tab only when it shows", async () => {
    await useFilesStore.getState().openFile("/tabs/a.ts");
    await useFilesStore.getState().openFile("/tabs/b.ts");
    useFilesStore.getState().setRoot("/other");
    expect(useFilesStore.getState().openFiles).toEqual([]);
    mocks.readFile.mockClear();
    useFilesStore.getState().setRoot("/tabs");
    expect(useFilesStore.getState().openFiles).toEqual(["/tabs/a.ts", "/tabs/b.ts"]);
    expect(useFilesStore.getState().activeFilePath).toBe("/tabs/b.ts");
    // Only the shown tab is read back.
    expect(mocks.readFile).toHaveBeenCalledTimes(1);
    useFilesStore.getState().activateFile("/tabs/a.ts");
    expect(mocks.readFile).toHaveBeenCalledTimes(2);
  });

  it("never restores a saved tab from outside the folder", () => {
    localStorage.setItem(
      tabsKey("/other"),
      JSON.stringify({ open: ["/elsewhere/x.ts", "/other/y.ts"], active: "/elsewhere/x.ts" }),
    );
    useFilesStore.getState().setRoot("/other");
    expect(useFilesStore.getState().openFiles).toEqual(["/other/y.ts"]);
    expect(useFilesStore.getState().activeFilePath).toBeNull();
  });

  it("a rename moves open tabs and unsaved marks with the file", async () => {
    await useFilesStore.getState().openFile("/tabs/src/a.ts");
    useFilesStore.getState().setFileDirty("/tabs/src/a.ts", true);
    useFilesStore.getState().remapTreePath("/tabs/src", "/tabs/lib");
    const state = useFilesStore.getState();
    expect(state.openFiles).toEqual(["/tabs/lib/a.ts"]);
    expect(state.activeFilePath).toBe("/tabs/lib/a.ts");
    expect(state.dirtyPaths).toEqual({ "/tabs/lib/a.ts": true });
    expect(state.fileStates["/tabs/lib/a.ts"].path).toBe("/tabs/lib/a.ts");
  });

  it("moving a path to the trash closes its tabs", async () => {
    await useFilesStore.getState().openFile("/tabs/src/a.ts");
    await useFilesStore.getState().openFile("/tabs/b.ts");
    useFilesStore.getState().removeTreePath("/tabs/src");
    expect(useFilesStore.getState().openFiles).toEqual(["/tabs/b.ts"]);
  });

  it("saves only a text file that was read whole", async () => {
    await useFilesStore.getState().openFile("/tabs/a.ts");
    await useFilesStore.getState().saveFile("/tabs/a.ts", "new");
    expect(mocks.writeFile).toHaveBeenCalledWith("/tabs/a.ts", "new");
    expect(useFilesStore.getState().fileStates["/tabs/a.ts"].content?.text).toBe("new");
    mocks.readFile.mockImplementationOnce(async () => ({
      kind: "text",
      text: "x",
      dataUrl: null,
      truncated: true,
    }));
    await useFilesStore.getState().openFile("/tabs/long.txt");
    await expect(useFilesStore.getState().saveFile("/tabs/long.txt", "y")).rejects.toThrow();
  });
});
