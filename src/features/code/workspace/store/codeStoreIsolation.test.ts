import { expect, it, vi } from "vitest";
import { createCodingWorkspaceStore, type OpenTab } from "./createCodingWorkspaceStore";
import { createEditorEphemeralStore } from "./createEditorEphemeralStore";

it("keeps identical project/view identifiers isolated between Code mounts", () => {
  const first = createCodingWorkspaceStore(),
    second = createCodingWorkspaceStore();
  const buffer: OpenTab = {
    path: "/project/main.ts",
    name: "main.ts",
    contents: "first",
    savedContents: "first",
    lineEnding: "lf",
    readonly: false,
    loading: false,
    error: null,
  };
  first.getState().openFile("/project", "same-view", buffer);
  second
    .getState()
    .openFile("/project", "same-view", { ...buffer, contents: "second", savedContents: "second" });
  first.getState().updateBufferContents("/project", buffer.path, "unsaved first");
  first.getState().toggleMark("/project", buffer.path);
  expect(first.getState().projectBuffers["/project"][buffer.path].contents).toBe("unsaved first");
  expect(second.getState().projectBuffers["/project"][buffer.path].contents).toBe("second");
  expect(second.getState().projects["/project"]?.marks ?? []).toEqual([]);
});
it("does not read or persist through host localStorage when a mount owns an in-memory store", () => {
  const get = vi.spyOn(Storage.prototype, "getItem"),
    set = vi.spyOn(Storage.prototype, "setItem");
  try {
    const store = createCodingWorkspaceStore();
    store.getState().setRootPath("/private-mount");
    store.getState().toggleMark("/private-mount", "file");
    expect(get).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  } finally {
    get.mockRestore();
    set.mockRestore();
  }
});
it("keeps cursor and language-server diagnostics local to the owning Code mount", () => {
  const first = createEditorEphemeralStore(),
    second = createEditorEphemeralStore();
  first.getState().setCursor("same-view", { line: 2, column: 3 });
  first
    .getState()
    .setProjectDiagnostics("/project", "file", [
      {
        path: "file",
        fromLine: 0,
        fromCharacter: 0,
        toLine: 0,
        toCharacter: 1,
        severity: "error",
        message: "private result",
      },
    ]);
  second.getState().setCursor("same-view", { line: 7, column: 8 });
  expect(first.getState().cursors["same-view"]).toEqual({ line: 2, column: 3 });
  expect(second.getState().cursors["same-view"]).toEqual({ line: 7, column: 8 });
  expect(second.getState().projectDiagnostics).toEqual({});
  first.getState().clearGroup("same-view");
  expect(second.getState().cursors["same-view"]).toEqual({ line: 7, column: 8 });
});
