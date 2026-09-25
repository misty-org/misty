import { act, cleanup, render } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { beforeAll, afterEach, expect, it, vi } from "vitest";
import { selectEditorPreferences } from "@/features/settings/store/preferences";
import { createSdkCodeFileFixture } from "./sdkCodeProject.fixture";
import { createSdkCodeRuntime } from "./sdkCodeRuntime";
import { createSdkCodeSessionState } from "./sdkCodeSessionState";
import { createSdkCodeEditor } from "./components/createSdkCodeEditor";
import { createSdkWorkspaceEdits } from "./lsp/createSdkWorkspaceEdits";
import { pathToUri } from "./lsp/client";

const dispose: Array<() => Promise<unknown>> = [];
beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});
afterEach(async () => {
  cleanup();
  for (const close of dispose.splice(0)) await close();
});
async function fixture() {
  const state = createSdkCodeSessionState(),
    a = createSdkCodeFileFixture(),
    b = a.fork();
  const first = createSdkCodeRuntime(a.sdk, undefined, state),
    second = createSdkCodeRuntime(b.sdk, undefined, state);
  const project = (await first.openProject())!;
  await second.openProject({ handoff: await project.share() });
  const root = project.root,
    path = `${root}/src/${a.file.name}`;
  dispose.push(async () => {
    await first.close();
    await second.close();
    state.close();
  });
  return { state, a, b, first, second, root, path };
}
it("does not erase a replacement mount's viewport or cursor when the old mount closes", async () => {
  const f = await fixture();
  await f.first.openFile(f.root, f.path, "same-view");
  await f.second.openFile(f.root, f.path, "same-view");
  f.second.editor.getState().setCursor("same-view", { line: 2, column: 3 });
  await f.first.close();
  expect(f.second.store.getState().views["same-view"].activeFilePath).toBe(f.path);
  expect(f.second.editor.getState().cursors["same-view"]).toEqual({ line: 2, column: 3 });
  await f.second.close();
  expect(f.state.store.getState().views).toEqual({});
  expect(f.state.editor.getState().cursors).toEqual({});
});
it("discards only an unopened peer grant while keeping the source's loaded project", async () => {
  const f = await fixture();
  await f.first.openFile(f.root, f.path, "source");
  await f.second.discardUnopenedProject(f.second.project(f.root));
  expect(f.second.hasProject(f.root)).toBe(false);
  expect(f.b.handles.size).toBe(0);
  expect(f.first.store.getState().projectBuffers[f.root][f.path].loaded).toBe(true);
  await f.first.saveFile(f.root, f.path, "source still works");
  expect(f.a.file.text).toBe("source still works");
});
it("serializes saves from separate owners and keeps typing made during either save dirty", async () => {
  const f = await fixture();
  await f.first.openFile(f.root, f.path, "first");
  await f.second.openFile(f.root, f.path, "second");
  const base = f.a.request.getMockImplementation()!;
  let finish!: () => void;
  f.a.request.mockImplementation(async (message) => {
    const result = await base(message);
    if (message.method === "files.writeText")
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    return result;
  });
  const a = f.first.saveFile(f.root, f.path, "first save");
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  const b = f.second.saveFile(f.root, f.path, "second save");
  f.state.store.getState().updateBufferContents(f.root, f.path, "still typing");
  expect(f.b.request.mock.calls.some(([m]) => m.method === "files.writeText")).toBe(false);
  finish();
  await Promise.all([a, b]);
  expect(f.a.file.text).toBe("second save");
  expect(f.state.store.getState().projectBuffers[f.root][f.path]).toMatchObject({
    contents: "still typing",
    savedContents: "second save",
  });
});
it("lets a peer retry an aborted shared read before the old native reply arrives", async () => {
  const f = await fixture(),
    base = f.a.request.getMockImplementation()!;
  let finish!: () => void;
  f.a.request.mockImplementation(async (message) => {
    const result = await base(message);
    if (message.method === "files.readText")
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    return result;
  });
  const loading = f.first.ensureFile(f.root, f.path),
    rejected = expect(loading).rejects.toThrow("closed");
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  const peer = f.second.ensureFile(f.root, f.path);
  await f.first.close();
  await rejected;
  await peer;
  f.state.store.getState().updateBufferContents(f.root, f.path, "peer typing");
  finish();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(f.state.store.getState().projectBuffers[f.root][f.path].contents).toBe("peer typing");
  expect(f.a.handles.size).toBe(0);
  expect(f.b.handles.size).toBeGreaterThan(0);
});
it("does not replace a peer's completed save with an older watcher read", async () => {
  const f = await fixture();
  await f.first.ensureFile(f.root, f.path);
  const base = f.a.request.getMockImplementation()!;
  let finish!: () => void;
  f.a.request.mockImplementation(async (message) => {
    const result = await base(message);
    if (message.method === "files.readText")
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    return result;
  });
  const refresh = f.first.refresh(f.root);
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  f.state.store.getState().updateBufferContents(f.root, f.path, "peer saved");
  await f.second.saveFile(f.root, f.path);
  finish();
  await refresh;
  expect(f.state.store.getState().projectBuffers[f.root][f.path]).toMatchObject({
    contents: "peer saved",
    savedContents: "peer saved",
  });
});
it("shares immutable previews but uses the source version and receiving project's write access", async () => {
  const f = await fixture();
  let version: number | null = 3;
  const first = createSdkWorkspaceEdits(f.first, { documentVersion: () => version });
  const second = createSdkWorkspaceEdits(f.second, { documentVersion: () => 99 });
  const preview = await first.prepareWorkspaceEdit("shared", f.root, "Rename", {
    documentChanges: [
      {
        textDocument: { uri: pathToUri(f.path), version: 3 },
        edits: [
          {
            range: { start: { line: 0, character: 6 }, end: { line: 0, character: 11 } },
            newText: "next",
          },
        ],
      },
    ],
  });
  expect(second.getWorkspaceEditPreview("shared")).toBe(preview);
  const readonlyFiles = f.a.fork();
  const readonly = createSdkCodeRuntime(readonlyFiles.sdk, undefined, f.state);
  await readonly.openProject({
    handoff: { ...(await f.first.project(f.root).share()), write: false },
  });
  const readonlyEdits = createSdkWorkspaceEdits(readonly);
  expect(() => readonlyEdits.applyWorkspaceEditPreview("shared")).toThrow("read-only project");
  await readonly.close();
  readonlyEdits.close();
  version = 4;
  expect(() => second.applyWorkspaceEditPreview("shared")).toThrow("version");
  await f.first.close();
  f.state.store.getState().updateBufferContents(f.root, f.path, "changed after source closed");
  expect(() => second.applyWorkspaceEditPreview("shared")).toThrow("changed");
  f.state.store.getState().updateBufferContents(f.root, f.path, preview.files[0].original);
  expect(second.applyWorkspaceEditPreview("shared")).toBe(true);
  first.close();
  second.close();
});
it("synchronizes two actual editors immediately and never flushes stale peer text on close", async () => {
  const f = await fixture();
  await f.first.openFile(f.root, f.path, "first");
  await f.second.openFile(f.root, f.path, "second");
  const options = {
    events: new EventTarget(),
    usePreferences: () => ({ ...selectEditorPreferences(null), autosaveDelayMs: 0 }),
    useShortcutHandler: () => undefined,
    ErrorActivity: ({ error }: { error: string }) => <p>{error}</p>,
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
  };
  const a = createSdkCodeEditor(f.first, options),
    b = createSdkCodeEditor(f.second, { ...options, events: new EventTarget() });
  dispose.unshift(async () => {
    a.close();
    b.close();
  });
  function Surface({ editor, id }: { editor: typeof a; id: string }) {
    const buffer = f.state.store((state) => state.projectBuffers[f.root][f.path]);
    return <editor.CodeEditor tab={buffer} rootPath={f.root} groupId={id} />;
  }
  const first = render(<Surface editor={a} id="first" />),
    second = render(<Surface editor={b} id="second" />);
  const cmA = EditorView.findFromDOM(first.container.querySelector(".cm-editor")!)!,
    cmB = EditorView.findFromDOM(second.container.querySelector(".cm-editor")!)!;
  act(() => cmA.dispatch({ changes: { from: cmA.state.doc.length, insert: "A" } }));
  expect(cmB.state.doc.toString()).toBe(cmA.state.doc.toString());
  act(() => cmB.dispatch({ changes: { from: cmB.state.doc.length, insert: "B" } }));
  expect(cmA.state.doc.toString()).toBe(cmB.state.doc.toString());
  act(() => {
    cmA.dispatch({ changes: { from: cmA.state.doc.length, insert: "C" } });
    b.close();
  });
  expect(f.state.store.getState().projectBuffers[f.root][f.path].contents).toBe(
    "const value = 1;\nABC",
  );
});
