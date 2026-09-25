import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { useEffect } from "react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { selectEditorPreferences } from "@/features/settings/store/preferences";
import { createSdkCodeFileFixture } from "../sdkCodeProject.fixture";
import { createSdkCodeRuntime } from "../sdkCodeRuntime";
import { createSdkCodeSearch } from "../sdkCodeSearch";
import { createSdkCodeEditor } from "../components/createSdkCodeEditor";
import { createCodeMultibuffer } from "../components/createCodeMultibuffer";
import { createSdkWorkspaceEdits } from "./createSdkWorkspaceEdits";
import { pathToUri } from "./client";
import { applyTextEdits } from "./textEdits";
const dispose: Array<() => Promise<void>> = [];
beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});
afterEach(async () => {
  cleanup();
  for (const close of dispose.splice(0)) await close();
});
const replacement = (newText = "next") => ({
  range: { start: { line: 0, character: 6 }, end: { line: 0, character: 11 } },
  newText,
});
async function fixture() {
  const files = createSdkCodeFileFixture(),
    runtime = createSdkCodeRuntime(files.sdk);
  files.file.text = "hello value\r\n";
  const project = (await runtime.openProject())!;
  const path = `${project.root}/src/${files.file.name}`;
  const edits = createSdkWorkspaceEdits(runtime);
  const change = { changes: { [pathToUri(path)]: [replacement()] } };
  dispose.push(async () => {
    edits.close();
    await runtime.close();
  });
  return { files, runtime, project, path, edits, change };
}
it("prepares SDK buffers without selecting a file and applies changes together without writing disk", async () => {
  const f = await fixture(),
    second = `${f.project.root}/second.ts`;
  f.files.root.children!.set("second.ts", {
    name: "second.ts",
    kind: "file",
    text: "hello value\n",
  });
  const preview = await f.edits.prepareWorkspaceEdit("edit", f.project.root, "Rename", {
    changes: { ...f.change.changes, [pathToUri(second)]: [replacement()] },
  });
  expect(f.runtime.store.getState().views).toEqual({});
  const snapshots: string[][] = [];
  const remove = f.runtime.store.subscribe((state) =>
    snapshots.push(
      [f.path, second].map((path) => state.projectBuffers[f.project.root][path].contents),
    ),
  );
  expect(f.edits.applyWorkspaceEditPreview(preview.id)).toBe(true);
  remove();
  expect(snapshots).toEqual([["hello next\n", "hello next\n"]]);
  expect(f.files.file.text).toBe("hello value\r\n");
  expect(f.edits.getWorkspaceEditPreview("edit")).toBeNull();
  expect(f.files.request.mock.calls.some(([m]) => m.method === "files.writeText")).toBe(false);
  await f.runtime.saveFile(f.project.root, f.path);
  expect(f.files.file.text).toBe("hello next\r\n");
});
it("rejects stale or read-only previews without changing any other file", async () => {
  const f = await fixture(),
    second = `${f.project.root}/second.ts`;
  f.files.root.children!.set("second.ts", {
    name: "second.ts",
    kind: "file",
    text: "hello value\n",
  });
  await f.edits.prepareWorkspaceEdit("edit", f.project.root, "Rename", {
    changes: { ...f.change.changes, [pathToUri(second)]: [replacement()] },
  });
  f.runtime.store.getState().updateBufferContents(f.project.root, second, "new typing\n");
  expect(() => f.edits.applyWorkspaceEditPreview("edit")).toThrow("changed");
  expect(f.runtime.store.getState().projectBuffers[f.project.root][f.path].contents).toBe(
    "hello value\n",
  );
  f.runtime.store.getState().patchBuffer(f.project.root, f.path, { readonly: true });
  await expect(
    f.edits.prepareWorkspaceEdit("readonly", f.project.root, "Rename", f.change),
  ).rejects.toThrow("read-only");
});
it("rejects unsupported and cross-project edits before file access", async () => {
  const f = await fixture(),
    before = f.files.request.mock.calls.length;
  for (const uri of [
    "file:///etc/passwd",
    "file://another-host/file",
    `${pathToUri(f.path)}?extra`,
    `${pathToUri(f.project.root)}/%2e%2e/outside`,
  ])
    await expect(
      f.edits.prepareWorkspaceEdit("bad", f.project.root, "Bad", {
        changes: { [uri]: [replacement()] },
      }),
    ).rejects.toThrow();
  await expect(
    f.edits.prepareWorkspaceEdit("resource", f.project.root, "Bad", {
      documentChanges: [{ kind: "delete", uri: pathToUri(f.path) } as never],
    }),
  ).rejects.toThrow("unsupported file operations");
  expect(f.files.request.mock.calls).toHaveLength(before);
});
it.each(["close", "discard"])("does not publish a delayed preview after %s", async (action) => {
  const f = await fixture(),
    base = f.files.request.getMockImplementation()!;
  let release!: () => void;
  f.files.request.mockImplementation(async (message) => {
    const result = await base(message);
    if (message.method === "files.readText")
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    return result;
  });
  const pending = f.edits.prepareWorkspaceEdit("pending", f.project.root, "Rename", f.change);
  const rejected = expect(pending).rejects.toThrow();
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  if (action === "close") f.edits.close();
  else f.edits.discardWorkspaceEditPreview("pending");
  release();
  await rejected;
  expect(f.edits.getWorkspaceEditPreview("pending")).toBeNull();
  expect(f.files.file.text).toBe("hello value\r\n");
});
it("checks versioned edits and allows unchanged buffers after their source editor closes", async () => {
  const f = await fixture();
  let version: number | null = 2;
  const edits = createSdkWorkspaceEdits(f.runtime, { documentVersion: () => version });
  const change = {
    documentChanges: [
      { textDocument: { uri: pathToUri(f.path), version: 3 }, edits: [replacement()] },
    ],
  };
  await expect(
    edits.prepareWorkspaceEdit("edit", f.project.root, "Rename", change),
  ).rejects.toThrow("version");
  version = 3;
  await edits.prepareWorkspaceEdit("edit", f.project.root, "Rename", change);
  version = 4;
  expect(() => edits.applyWorkspaceEditPreview("edit")).toThrow("version");
  version = null;
  expect(edits.applyWorkspaceEditPreview("edit")).toBe(true);
  expect(f.runtime.store.getState().projectBuffers[f.project.root][f.path].contents).toBe(
    "hello next\n",
  );
  edits.close();
});
it("does not share preview identities between owners or allow callers to rewrite their contents", async () => {
  const f = await fixture(),
    other = createSdkWorkspaceEdits(f.runtime);
  const preview = await f.edits.prepareWorkspaceEdit("same", f.project.root, "Rename", f.change);
  expect(other.getWorkspaceEditPreview("same")).toBeNull();
  expect(() => {
    (preview.files[0] as { proposed: string }).proposed = "injected";
  }).toThrow();
  expect(other.applyWorkspaceEditPreview("same")).toBe(false);
  other.close();
});
it("flushes an actual SDK editor before preparing a preview", async () => {
  const f = await fixture();
  await f.runtime.openFile(f.project.root, f.path, "view");
  const editor = createSdkCodeEditor(f.runtime, {
    events: new EventTarget(),
    usePreferences: () => ({ ...selectEditorPreferences(null), autosaveDelayMs: 0 }),
    useShortcutHandler: () => undefined,
    ErrorActivity: ({ error }) => <p role="alert">{error}</p>,
    lsp: {
      codeActions: async () => [],
      documentSymbols: async () => [],
      executeLspCommand: async () => undefined,
      formatDocument: async () => false,
      lspExtension: () => [],
      renameSymbol: async () => null,
      showSymbolInformation: async () => false,
      goToDefinition: async () => false,
    },
  });
  function Surface() {
    const buffer = f.runtime.store((state) => state.projectBuffers[f.project.root][f.path]);
    return <editor.CodeEditor tab={buffer} rootPath={f.project.root} groupId="view" />;
  }
  const view = render(<Surface />);
  const cm = EditorView.findFromDOM(view.container.querySelector(".cm-editor")!)!;
  act(() =>
    cm.dispatch({ changes: { from: 0, to: cm.state.doc.length, insert: "typed value\n" } }),
  );
  expect(f.runtime.store.getState().projectBuffers[f.project.root][f.path].contents).toBe(
    "hello value\n",
  );
  let preview!: Awaited<ReturnType<typeof f.edits.prepareWorkspaceEdit>>;
  await act(async () => {
    preview = await f.edits.prepareWorkspaceEdit("live", f.project.root, "Rename", f.change);
  });
  expect(preview.files[0]).toMatchObject({ original: "typed value\n", proposed: "typed next\n" });
  act(() => editor.close());
});
it("uses the real multibuffer UI to review, apply and save through the SDK", async () => {
  const f = await fixture(),
    search = createSdkCodeSearch(f.runtime),
    shortcuts = new Map<string, () => unknown>(),
    report = vi.fn();
  await f.edits.prepareWorkspaceEdit("review", f.project.root, "Rename value", f.change);
  const Multibuffer = createCodeMultibuffer({
    store: f.runtime.store,
    editorStore: f.runtime.editor,
    usePreferences: () => ({ ...selectEditorPreferences(null), autosaveDelayMs: 0 }),
    useShortcutHandler: (id, run) =>
      useEffect(() => {
        shortcuts.set(id, run);
        return () => {
          shortcuts.delete(id);
        };
      }, [id, run]),
    findInFiles: search.search,
    ensureBuffer: f.runtime.ensureFile,
    findReferencesAt: async () => [],
    edits: f.edits,
    saveFile: f.runtime.saveFile,
    report,
    ErrorActivity: ({ error }) => <p role="alert">{error}</p>,
  });
  const view = render(
    <Multibuffer
      viewId="review"
      rootPath={f.project.root}
      spec={{
        id: "review",
        kind: "rename",
        title: "Rename value",
        origin: { path: f.path, line: 0, character: 6 },
        expired: true,
      }}
      onOpenFile={vi.fn()}
      onOpenFileInNewTab={vi.fn()}
    />,
  );
  const apply = await screen.findByRole("button", { name: "Apply" });
  const cm = EditorView.findFromDOM(view.container.querySelector(".cm-editor")!)!;
  expect(cm.state.doc.toString()).toContain("hello next");
  expect(f.files.file.text).toBe("hello value\r\n");
  fireEvent.click(apply);
  await vi.waitFor(() =>
    expect(f.runtime.store.getState().projectBuffers[f.project.root][f.path].contents).toBe(
      "hello next\n",
    ),
  );
  const originalRequest = f.files.request.getMockImplementation()!;
  f.files.request.mockImplementation(async (message) => {
    if (message.method === "files.writeText") throw new Error("Temporary save failure");
    return originalRequest(message);
  });
  await act(async () => {
    await shortcuts.get("code.save")?.();
  });
  await vi.waitFor(() => expect(report).toHaveBeenCalledOnce());
  expect(f.runtime.store.getState().projectBuffers[f.project.root][f.path]).toMatchObject({
    contents: "hello next\n",
    savedContents: "hello value\n",
  });
  expect(view.container.querySelector(".cm-editor")).toBeTruthy();
  f.files.request.mockImplementation(originalRequest);
  await act(async () => {
    await shortcuts.get("code.save")?.();
  });
  await vi.waitFor(() => expect(f.files.file.text).toBe("hello next\r\n"));
  search.close();
});
it("applies UTF-16 edits in input order and rejects overlapping ranges", () => {
  const insert = (newText: string) => ({
    range: { start: { line: 0, character: 2 }, end: { line: 0, character: 2 } },
    newText,
  });
  expect(applyTextEdits("😀x\nnext", [insert("A"), insert("B")])).toBe("😀ABx\nnext");
  expect(
    applyTextEdits("first\nnext", [
      {
        range: { start: { line: 0, character: 999 }, end: { line: 0, character: 999 } },
        newText: "!",
      },
    ]),
  ).toBe("first!\nnext");
  expect(() => applyTextEdits("hello value", [replacement(), replacement()])).toThrow("overlap");
  expect(() =>
    applyTextEdits("hello value", [
      { range: { start: { line: 0, character: 9 }, end: { line: 0, character: 2 } }, newText: "" },
    ]),
  ).toThrow("reversed");
});

it("keeps a read-only search excerpt unchanged when editing is attempted", async () => {
  const f = await fixture(),
    search = createSdkCodeSearch(f.runtime);
  f.files.file.readOnly = true;
  const Multibuffer = createCodeMultibuffer({
    store: f.runtime.store,
    editorStore: f.runtime.editor,
    usePreferences: () => selectEditorPreferences(null),
    useShortcutHandler: () => undefined,
    findInFiles: search.search,
    ensureBuffer: f.runtime.ensureFile,
    findReferencesAt: async () => [],
    edits: f.edits,
    saveFile: f.runtime.saveFile,
    report: vi.fn(),
    ErrorActivity: ({ error }) => <p>{error}</p>,
  });
  const view = render(
    <Multibuffer
      viewId="readonly"
      rootPath={f.project.root}
      spec={{ kind: "search", id: "search", title: "Search", query: "hello", caseSensitive: false }}
      onOpenFile={vi.fn()}
      onOpenFileInNewTab={vi.fn()}
    />,
  );
  await vi.waitFor(() => expect(view.container.querySelector(".cm-editor")).toBeTruthy());
  const cm = EditorView.findFromDOM(view.container.querySelector(".cm-editor")!)!,
    before = cm.state.doc.toString();
  act(() => cm.dispatch({ changes: { from: before.indexOf("hello"), insert: "blocked " } }));
  expect(cm.state.doc.toString()).toBe(before);
  expect(f.runtime.store.getState().projectBuffers[f.project.root][f.path].contents).toBe(
    "hello value\n",
  );
  search.close();
});
it("rejects a changed earlier file while a later file is still loading for a preview", async () => {
  const f = await fixture(),
    second = `${f.project.root}/second.ts`;
  f.files.root.children!.set("second.ts", {
    name: "second.ts",
    kind: "file",
    text: "hello value\n",
  });
  const base = f.files.request.getMockImplementation()!;
  let release!: () => void;
  f.files.request.mockImplementation(async (message) => {
    const result = await base(message);
    if (
      message.method === "files.readText" &&
      f.files.handles.get((message.params as { handle: string }).handle)?.node.name === "second.ts"
    )
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    return result;
  });
  const pending = f.edits.prepareWorkspaceEdit("changing", f.project.root, "Rename", {
    changes: { ...f.change.changes, [pathToUri(second)]: [replacement()] },
  });
  const rejected = expect(pending).rejects.toThrow("changed while preparing");
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  f.runtime.store.getState().updateBufferContents(f.project.root, f.path, "typing while loading\n");
  release();
  await rejected;
  expect(f.edits.getWorkspaceEditPreview("changing")).toBeNull();
  expect(f.files.file.text).toBe("hello value\r\n");
});

it("keeps sequential multibuffer transactions and excerpt-edge inserts in their source file", async () => {
  const f = await fixture(),
    search = createSdkCodeSearch(f.runtime);
  const Multibuffer = createCodeMultibuffer({
    store: f.runtime.store,
    editorStore: f.runtime.editor,
    usePreferences: () => selectEditorPreferences(null),
    useShortcutHandler: () => undefined,
    findInFiles: search.search,
    ensureBuffer: f.runtime.ensureFile,
    findReferencesAt: async () => [],
    edits: f.edits,
    saveFile: f.runtime.saveFile,
    report: vi.fn(),
    ErrorActivity: ({ error }) => <p>{error}</p>,
  });
  const view = render(
    <Multibuffer
      viewId="editing"
      rootPath={f.project.root}
      spec={{ kind: "search", id: "search", title: "Search", query: "hello", caseSensitive: false }}
      onOpenFile={vi.fn()}
      onOpenFileInNewTab={vi.fn()}
    />,
  );
  await vi.waitFor(() => expect(view.container.querySelector(".cm-editor")).toBeTruthy());
  const cm = EditorView.findFromDOM(view.container.querySelector(".cm-editor")!)!,
    start = cm.state.doc.toString().indexOf("hello");
  act(() => {
    const first = cm.state.update({ changes: { from: start, insert: "A" } });
    const second = first.state.update({ changes: { from: start + 1, insert: "B" } });
    cm.update([first, second]);
  });
  expect(f.runtime.store.getState().projectBuffers[f.project.root][f.path].contents).toBe(
    "ABhello value\n",
  );
  act(() => cm.dispatch({ changes: { from: cm.state.doc.length, insert: "tail" } }));
  expect(f.runtime.store.getState().projectBuffers[f.project.root][f.path].contents).toBe(
    "ABhello value\ntail",
  );
  expect(f.files.file.text).toBe("hello value\r\n");
  search.close();
});
