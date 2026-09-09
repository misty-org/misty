import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createMistyAppSDK, type MistyLspEvent } from "@misty/sdk";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { createEditorEphemeralStore } from "../store/createEditorEphemeralStore";
import { pathToUri, type LspMessage } from "./client";
import { createCodeMirrorLsp } from "./createCodeMirrorLsp";
import { createCodeLspRegistry } from "./registry";
import { createSdkCodeLspTransport } from "./sdkTransport";

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
});
const disposals: Array<() => void> = [];
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose();
});

function mount() {
  const root = "/selected/project",
    path = `${root}/日本語 #?.ts`;
  let receive!: (value: MistyLspEvent) => void;
  const messages: LspMessage[] = [];
  const responses = new Map<string, (message: LspMessage) => unknown | Promise<unknown>>();
  const remove = vi.fn();
  const request = vi.fn(async ({ method, params }: { method: string; params?: unknown }) => {
    if (method === "code.lsp.start") return { handle: "owned-language-server" };
    if (method === "code.lsp.stop") return;
    if (method === "code.lsp.send") {
      const message = JSON.parse((params as { payload: string }).payload) as LspMessage;
      messages.push(message);
      if (message.id != null) {
        const result = responses.has(message.method!)
          ? await responses.get(message.method!)!(message)
          : message.method === "initialize"
            ? { capabilities: {} }
            : null;
        receive({
          type: "message",
          payload: JSON.stringify({ jsonrpc: "2.0", id: message.id, result }),
        });
      }
      return;
    }
    throw new Error(`Unexpected SDK method ${method}`);
  });
  const sdk = createMistyAppSDK({
    request,
    subscribe: async (topic, listener) => {
      expect(topic).toBe("code-lsp:owned-language-server");
      receive = listener;
      return remove;
    },
  });
  const registry = createCodeLspRegistry(createSdkCodeLspTransport(sdk));
  const editorStore = createEditorEphemeralStore(),
    events = new EventTarget();
  const lsp = createCodeMirrorLsp({ getLspClient: registry.get, editorStore, events });
  const host = document.createElement("div");
  document.body.append(host);
  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: "const value = 1;",
      extensions: lsp.lspExtension(path, root, "same-view"),
    }),
  });
  disposals.push(() => {
    view.destroy();
    registry.close();
    host.remove();
  });
  const focus = async () => {
    view.focus();
    await vi.waitFor(() =>
      expect(messages.some((m) => m.method === "textDocument/didOpen")).toBe(true),
    );
  };
  return {
    root,
    path,
    view,
    focus,
    request,
    messages,
    responses,
    registry,
    lsp,
    editorStore,
    events,
    remove,
    emit: (message: LspMessage) => receive({ type: "message", payload: JSON.stringify(message) }),
  };
}

it("routes CodeMirror language requests through the SDK and keeps diagnostics/navigation in their owning mount", async () => {
  const first = mount(),
    second = mount();
  await first.focus();
  await second.focus();
  const range = { start: { line: 0, character: 6 }, end: { line: 0, character: 11 } };
  first.emit({
    jsonrpc: "2.0",
    method: "textDocument/publishDiagnostics",
    params: {
      uri: pathToUri(first.path),
      diagnostics: [{ range, severity: 1, message: "First mount diagnostic" }],
    },
  });
  expect(first.editorStore.getState().projectDiagnostics[first.root][first.path][0].message).toBe(
    "First mount diagnostic",
  );
  expect(second.editorStore.getState().projectDiagnostics).toEqual({});
  const firstNavigation = vi.fn(),
    secondNavigation = vi.fn();
  first.events.addEventListener("misty:code-open-file", firstNavigation);
  second.events.addEventListener("misty:code-open-file", secondNavigation);
  first.responses.set("textDocument/definition", () => ({
    uri: pathToUri(`${first.root}/other.ts`),
    range,
  }));
  await expect(
    first.lsp.goToDefinition(first.view, first.path, first.root, "same-view"),
  ).resolves.toBe(true);
  expect(firstNavigation).toHaveBeenCalledOnce();
  expect(secondNavigation).not.toHaveBeenCalled();
  expect(first.messages.find((m) => m.method === "textDocument/definition")?.params).toMatchObject({
    textDocument: { uri: pathToUri(first.path) },
  });
  expect(first.request).toHaveBeenCalledWith(
    expect.objectContaining({
      method: "code.lsp.start",
      params: { language: "typescript", cwd: first.root },
    }),
  );
});

it("rejects stale formatting edits and accepts formatting for the current document", async () => {
  const f = mount();
  await f.focus();
  const edits = [
    { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }, newText: "let" },
  ];
  let finish!: (value: typeof edits) => void;
  f.responses.set(
    "textDocument/formatting",
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = f.lsp.formatDocument(f.view, f.path, f.root);
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  f.view.dispatch({ changes: { from: 0, to: 5, insert: "var" } });
  finish(edits);
  await expect(pending).resolves.toBe(false);
  expect(f.view.state.doc.toString()).toBe("var value = 1;");
  f.responses.set("textDocument/formatting", () => [
    { ...edits[0], range: { ...edits[0].range, end: { line: 0, character: 3 } } },
  ]);
  await expect(f.lsp.formatDocument(f.view, f.path, f.root)).resolves.toBe(true);
  expect(f.view.state.doc.toString()).toBe("let value = 1;");
});

it("ignores late language replies and stops the SDK process when its registry closes", async () => {
  const f = mount();
  await f.focus();
  let finish!: (value: unknown) => void;
  f.responses.set(
    "textDocument/hover",
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = f.lsp.showSymbolInformation(f.view, f.path, f.root);
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  f.registry.close();
  finish({ contents: "late hover" });
  await expect(pending).resolves.toBe(false);
  expect(f.remove).toHaveBeenCalledOnce();
  await vi.waitFor(() =>
    expect(f.request).toHaveBeenCalledWith(expect.objectContaining({ method: "code.lsp.stop" })),
  );
});

it("tracks document versions only within their owning live editors", async () => {
  const first = mount(),
    second = mount();
  expect(first.lsp.documentVersion(first.root, first.path)).toBe(1);
  first.view.dispatch({ changes: { from: 0, to: 0, insert: "// typed\n" } });
  expect(first.lsp.documentVersion(first.root, first.path)).toBe(2);
  expect(second.lsp.documentVersion(second.root, second.path)).toBe(1);
  first.view.destroy();
  expect(first.lsp.documentVersion(first.root, first.path)).toBeNull();
});
