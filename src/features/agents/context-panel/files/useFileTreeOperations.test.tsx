// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VisibleNode } from "./visibleNodes";

const mocks = vi.hoisted(() => ({
  clipboardSnapshot: vi.fn(),
  clipboardSetFiles: vi.fn(),
  pasteClipboard: vi.fn(),
  paste: vi.fn(),
  listDir: vi.fn(async () => []),
  gitTreeStatus: vi.fn(async () => ({ repositories: [], fileColors: {} })),
  sendPathToComposer: vi.fn(),
}));

vi.mock("./filesApi", () => ({ filesApi: mocks }));
vi.mock("./sendToComposer", () => ({ sendPathToComposer: mocks.sendPathToComposer }));
vi.mock("./fileIndex", () => ({ useFileIndex: { getState: () => ({ invalidate: () => {} }) } }));
vi.mock("./treePreferences", async () => {
  const { create } = await import("zustand");
  return { useTreePreferences: create(() => ({ hideIgnored: false })) };
});

import { useFilesStore } from "./filesStore";
import { useFileTreeOperations } from "./useFileTreeOperations";

/**
 * The tree's Copy and Paste are the system clipboard's: Copy stages the item for the menu and
 * puts the file on the clipboard, Paste reads the clipboard first (a copy made in Finder, or one
 * newer than the tree's) and only falls back to the tree's own item.
 */
function renderHook<T>(hook: () => T) {
  const result = {} as { current: T };
  function TestComponent() {
    result.current = hook();
    return null;
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<TestComponent />));
  return {
    result,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

const node = (path: string, isDir = false): VisibleNode => ({
  name: path.slice(path.lastIndexOf("/") + 1),
  path,
  isDir,
  size: 0,
  mtimeMs: 0,
  depth: 0,
  expanded: false,
  loading: false,
});

const menuEvent = () => ({ preventDefault: vi.fn() }) as unknown as React.MouseEvent<HTMLElement>;

/** Drains the chained awaits inside the menu's fire-and-forget handlers. */
async function flush() {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

describe("the file tree's clipboard", () => {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    mocks.clipboardSnapshot.mockResolvedValue({ paths: [], changeCount: null });
    mocks.clipboardSetFiles.mockResolvedValue(null);
    mocks.pasteClipboard.mockResolvedValue({ created: [], failed: [] });
    mocks.paste.mockResolvedValue({ path: "/repo/notes.md", isDir: false });
    useFilesStore.setState({
      root: "/repo",
      // Nothing listed: the reveal after a paste has nothing to read again.
      children: {},
      expanded: { "/repo": true },
      loadingDirs: {},
      dirErrors: {},
      clipboard: null,
      selectedPath: null,
      selectedIsDir: false,
    });
  });

  let unmount: (() => void) | null = null;
  afterEach(() => {
    unmount?.();
    unmount = null;
  });

  type Hook = { result: { current: ReturnType<typeof useFileTreeOperations> } };
  /** Opens the menu on `path`, then Copy, in separate acts so the menu is there first. */
  async function copyFromMenu(hook: Hook, path: string) {
    act(() => hook.result.current.openContextMenu(menuEvent(), node(path)));
    await act(async () => {
      hook.result.current.copyItem();
      await flush();
    });
  }
  async function pasteInto(hook: Hook, dir = "/repo") {
    await act(async () => {
      hook.result.current.paste(dir);
      await flush();
    });
  }

  it("Copy stages the item, puts the file on the clipboard and records its change count", async () => {
    mocks.clipboardSetFiles.mockResolvedValue(8);
    const hook = renderHook(() => useFileTreeOperations());
    unmount = hook.unmount;
    await copyFromMenu(hook, "/repo/notes.md");
    expect(mocks.clipboardSetFiles).toHaveBeenCalledWith(["/repo/notes.md"]);
    expect(useFilesStore.getState().clipboard).toEqual({
      path: "/repo/notes.md",
      isDir: false,
      osChangeCount: 8,
    });
  });

  it("Paste uses a newer copy from the system over an older tree item", async () => {
    mocks.clipboardSnapshot.mockResolvedValue({ paths: ["/elsewhere/draft.md"], changeCount: 7 });
    mocks.pasteClipboard.mockResolvedValue({
      created: [{ path: "/repo/draft.md", isDir: false }],
      failed: [],
    });
    useFilesStore.setState({
      clipboard: { path: "/repo/stale.md", isDir: false, osChangeCount: 6 },
    });
    const hook = renderHook(() => useFileTreeOperations());
    unmount = hook.unmount;
    await pasteInto(hook);
    expect(mocks.pasteClipboard).toHaveBeenCalledWith("/repo");
    expect(mocks.paste).not.toHaveBeenCalled();
  });

  it("Paste uses the tree's copy when the clipboard hasn't changed since", async () => {
    mocks.clipboardSetFiles.mockResolvedValue(7);
    mocks.clipboardSnapshot.mockResolvedValue({ paths: ["/elsewhere/old.md"], changeCount: 7 });
    const hook = renderHook(() => useFileTreeOperations());
    unmount = hook.unmount;
    await copyFromMenu(hook, "/repo/new.md");
    await pasteInto(hook);
    expect(mocks.paste).toHaveBeenCalledWith("/repo/new.md", "/repo");
    expect(mocks.pasteClipboard).not.toHaveBeenCalled();
  });

  it("doesn't paste the tree's copy after newer text was copied", async () => {
    mocks.clipboardSetFiles.mockResolvedValue(8);
    mocks.clipboardSnapshot.mockResolvedValue({ paths: [], changeCount: 9 });
    const hook = renderHook(() => useFileTreeOperations());
    unmount = hook.unmount;
    await copyFromMenu(hook, "/repo/b.md");
    await pasteInto(hook);
    expect(mocks.paste).not.toHaveBeenCalled();
    expect(hook.result.current.notice).toBe("Nothing to paste.");
  });

  it("Paste pastes the renamed item, not the old path still on the clipboard", async () => {
    mocks.clipboardSetFiles.mockResolvedValue(8);
    mocks.clipboardSnapshot.mockResolvedValue({ paths: ["/repo/b.md"], changeCount: 8 });
    const hook = renderHook(() => useFileTreeOperations());
    unmount = hook.unmount;
    await copyFromMenu(hook, "/repo/b.md");
    act(() => useFilesStore.getState().remapTreePath("/repo/b.md", "/repo/b2.md"));
    await pasteInto(hook);
    expect(mocks.paste).toHaveBeenCalledWith("/repo/b2.md", "/repo");
  });

  it("turns Paste off once newer text replaced the tree's item", async () => {
    mocks.clipboardSetFiles.mockResolvedValue(8);
    mocks.clipboardSnapshot.mockResolvedValue({ paths: ["/repo/b.md"], changeCount: 8 });
    const hook = renderHook(() => useFileTreeOperations());
    unmount = hook.unmount;
    await copyFromMenu(hook, "/repo/b.md");
    await act(async () => {
      hook.result.current.openContextMenu(menuEvent(), node("/repo", true));
      await flush();
    });
    expect(hook.result.current.canPaste).toBe(true);
    mocks.clipboardSnapshot.mockResolvedValue({ paths: [], changeCount: 9 });
    await act(async () => {
      hook.result.current.openContextMenu(menuEvent(), node("/repo", true));
      await flush();
    });
    expect(hook.result.current.canPaste).toBe(false);
  });

  it("writes copies in order, so an older write can't finish last", async () => {
    const first = deferred<number>();
    const second = deferred<number>();
    mocks.clipboardSetFiles.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const hook = renderHook(() => useFileTreeOperations());
    unmount = hook.unmount;
    await copyFromMenu(hook, "/repo/a.md");
    await copyFromMenu(hook, "/repo/b.md");
    expect(mocks.clipboardSetFiles).toHaveBeenCalledTimes(1);
    await act(async () => {
      first.resolve(1);
      await flush();
    });
    expect(mocks.clipboardSetFiles).toHaveBeenLastCalledWith(["/repo/b.md"]);
    await act(async () => {
      second.resolve(2);
      await flush();
    });
    expect(useFilesStore.getState().clipboard).toEqual({
      path: "/repo/b.md",
      isDir: false,
      osChangeCount: 2,
    });
  });

  it("falls back to the tree's item when the clipboard holds no files", async () => {
    useFilesStore.setState({ clipboard: { path: "/repo/notes.md", isDir: false } });
    const hook = renderHook(() => useFileTreeOperations());
    unmount = hook.unmount;
    await pasteInto(hook);
    expect(mocks.pasteClipboard).not.toHaveBeenCalled();
    expect(mocks.paste).toHaveBeenCalledWith("/repo/notes.md", "/repo");
  });

  it("reports a failed clipboard read instead of pasting a stale item", async () => {
    mocks.clipboardSnapshot.mockRejectedValue(new Error("The clipboard is busy."));
    useFilesStore.setState({ clipboard: { path: "/repo/stale.md", isDir: false } });
    const hook = renderHook(() => useFileTreeOperations());
    unmount = hook.unmount;
    await pasteInto(hook);
    expect(mocks.paste).not.toHaveBeenCalled();
    expect(hook.result.current.notice).toBe("The clipboard is busy.");
  });

  it("names each item that couldn't be copied", async () => {
    mocks.clipboardSnapshot.mockResolvedValue({ paths: ["/elsewhere/gone.md"], changeCount: 7 });
    mocks.pasteClipboard.mockResolvedValue({ created: [], failed: ["Couldn't read gone.md"] });
    const hook = renderHook(() => useFileTreeOperations());
    unmount = hook.unmount;
    await pasteInto(hook);
    expect(hook.result.current.notice).toBe("Couldn't read gone.md");
  });

  it("never renames or trashes the linked folder itself", () => {
    const hook = renderHook(() => useFileTreeOperations());
    unmount = hook.unmount;
    act(() => hook.result.current.openContextMenu(menuEvent(), node("/repo", true)));
    act(() => hook.result.current.startRename());
    act(() => hook.result.current.startTrash());
    expect(hook.result.current.prompt).toBeNull();
    expect(hook.result.current.trashTarget).toBeNull();
  });

  it("sends the path to the chat's composer", () => {
    const hook = renderHook(() => useFileTreeOperations());
    unmount = hook.unmount;
    act(() => hook.result.current.openContextMenu(menuEvent(), node("/repo/src", true)));
    act(() => hook.result.current.sendPath());
    expect(mocks.sendPathToComposer).toHaveBeenCalledWith("/repo", "/repo/src", true);
  });
});
