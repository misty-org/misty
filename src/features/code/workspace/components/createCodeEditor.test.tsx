import { act, cleanup, render } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { undo } from "@codemirror/commands";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { selectEditorPreferences } from "@/features/settings/store/preferences";
import { createSdkCodeFileFixture } from "../sdkCodeProject.fixture";
import { createSdkCodeRuntime } from "../sdkCodeRuntime";
import type { CodeEditorServices } from "./createCodeEditor";
import { createSdkCodeEditor } from "./createSdkCodeEditor";

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
});
const disposals: Array<() => Promise<void>> = [];
afterEach(async () => {
  cleanup();
  for (const dispose of disposals.splice(0)) await dispose();
});

async function mount() {
  const fixture = createSdkCodeFileFixture();
  const runtime = createSdkCodeRuntime(fixture.sdk);
  const project = (await runtime.openProject({ write: true }))!;
  const path = `${project.root}/src/${fixture.file.name}`;
  await runtime.openFile(project.root, path, "same-view");
  const shortcuts = new Map<string, { run: () => void; active: () => boolean }>();
  const lsp: CodeEditorServices["lsp"] = {
    codeActions: vi.fn(async () => []),
    documentSymbols: vi.fn(async () => []),
    executeLspCommand: vi.fn(async () => undefined),
    formatDocument: vi.fn(async () => false),
    lspExtension: () => [],
    renameSymbol: vi.fn(async () => null),
    showSymbolInformation: vi.fn(async () => false),
    goToDefinition: vi.fn(async () => false),
  };
  const events = new EventTarget();
  const preferences = { ...selectEditorPreferences(null), autosaveDelayMs: 0 };
  const editor = createSdkCodeEditor(runtime, {
    events,
    lsp,
    usePreferences: () => preferences,
    useShortcutHandler: (id, run, active) => {
      shortcuts.set(id, { run, active });
    },
    ErrorActivity: () => null,
  });
  function Surface() {
    const tab = runtime.store((state) => state.projectBuffers[project.root]?.[path]);
    return tab ? <editor.CodeEditor tab={tab} rootPath={project.root} groupId="same-view" /> : null;
  }
  const rendered = render(<Surface />);
  const view = EditorView.findFromDOM(rendered.container.querySelector(".cm-editor")!)!;
  expect(view).toBeTruthy();
  const buffer = () => runtime.store.getState().projectBuffers[project.root][path];
  const replace = (text: string) =>
    act(() => {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
    });
  const save = () =>
    act(() => {
      shortcuts.get("code.save")!.run();
    });
  disposals.push(async () => {
    editor.close();
    await runtime.close();
  });
  return {
    fixture,
    runtime,
    project,
    path,
    editor,
    shortcuts,
    events,
    lsp,
    preferences,
    rendered,
    view,
    buffer,
    replace,
    save,
  };
}

it("uses independent SDK stores, event channels and live editors even with identical view IDs", async () => {
  const first = await mount(),
    second = await mount();
  first.replace("private first contents");
  second.replace("private second contents");
  const firstAi = vi.fn(),
    secondAi = vi.fn();
  first.events.addEventListener("misty:code-inline-ai", firstAi);
  second.events.addEventListener("misty:code-inline-ai", secondAi);
  expect(first.editor.requestInlineAi("same-view")).toBe(true);
  expect(firstAi).toHaveBeenCalledOnce();
  expect(secondAi).not.toHaveBeenCalled();
  expect(first.editor.editorLocation("same-view")?.path).toBe(first.path);
  expect(second.editor.editorLocation("same-view")?.path).toBe(second.path);
  first.save();
  await act(async () => {
    await vi.waitFor(() => expect(first.fixture.file.text).toBe("private first contents"));
  });
  expect(second.fixture.file.text).not.toBe("private first contents");
  act(() => first.editor.close());
  expect(first.editor.requestInlineAi("same-view")).toBe(false);
  expect(first.rendered.container.querySelector(".cm-editor")).toBeNull();
  expect(second.rendered.container.querySelector(".cm-editor")).toBeTruthy();
  second.rendered.unmount();
  expect(second.buffer().contents).toBe("private second contents");
});

it("saves the captured document through the SDK while preserving subsequent typing and save ordering", async () => {
  const f = await mount();
  const original = f.fixture.request.getMockImplementation()!;
  const writes: Array<() => void> = [];
  f.fixture.request.mockImplementation(async (request) => {
    const result = await original(request);
    if (request.method === "files.writeText")
      await new Promise<void>((resolve) => {
        writes.push(resolve);
      });
    return result;
  });
  f.replace("first");
  f.save();
  await act(async () => {
    await vi.waitFor(() => expect(writes).toHaveLength(1));
  });
  f.replace("second");
  f.save();
  f.replace("still typing");
  act(() => writes[0]());
  await act(async () => {
    await vi.waitFor(() => expect(writes).toHaveLength(2));
  });
  expect(f.buffer().savedContents).toBe("first");
  expect(f.view.state.doc.toString()).toBe("still typing");
  act(() => writes[1]());
  await act(async () => {
    await vi.waitFor(() => expect(f.buffer().savedContents).toBe("second"));
  });
  f.rendered.unmount();
  expect(f.buffer().contents).toBe("still typing");
  expect(f.fixture.file.text).toBe("second");
});

it("does not save after closure while format-on-save is awaiting a language server", async () => {
  const f = await mount();
  let formatted!: () => void;
  // Trigger the explicit formatting shortcut and prove it uses this mount's LSP service.
  await act(async () => {
    f.shortcuts.get("code.format_document")!.run();
  });
  expect(f.lsp.formatDocument).toHaveBeenCalledOnce();
  f.preferences.formatOnSave = true;
  vi.mocked(f.lsp.formatDocument).mockImplementationOnce(async () => {
    await new Promise<void>((resolve) => {
      formatted = resolve;
    });
    return true;
  });
  f.replace("final unsaved contents");
  f.save();
  expect(formatted).toBeTypeOf("function");
  act(() => f.editor.close());
  await act(async () => {
    formatted();
    await Promise.resolve();
  });
  expect(
    f.fixture.request.mock.calls.filter(([request]) => request.method === "files.writeText"),
  ).toHaveLength(0);
  expect(f.buffer().contents).toBe("final unsaved contents");
});

it("does not revive SDK state when a write finishes after the runtime has closed", async () => {
  const f = await mount();
  let finishWrite!: () => void;
  f.replace("final unsaved contents");
  const original = f.fixture.request.getMockImplementation()!;
  f.fixture.request.mockImplementation(async (request) => {
    if (request.method === "files.writeText")
      await new Promise<void>((resolve) => {
        finishWrite = resolve;
      });
    return original(request);
  });
  f.save();
  await act(async () => {
    await vi.waitFor(() => expect(finishWrite).toBeTypeOf("function"));
  });
  act(() => f.editor.close());
  await act(async () => {
    await f.runtime.close();
  });
  await act(async () => {
    finishWrite();
    await Promise.resolve();
  });
  expect(f.runtime.store.getState().projectBuffers).toEqual({});
  expect(f.runtime.editor.getState().cursors).toEqual({});
  expect(f.editor.editorLocation("same-view")).toBeNull();
});

it("keeps the same editable document and undo history when disk refresh or saving fails", async () => {
  const f = await mount();
  f.replace("unsaved changes");
  await act(async () => {
    await vi.waitFor(() => expect(f.buffer().contents).toBe("unsaved changes"));
  });
  f.fixture.file.text = "external changes";
  await act(async () => {
    await f.runtime.refresh(f.project.root);
  });
  expect(f.rendered.getByRole("alert").textContent).toContain("changed on disk");
  expect(EditorView.findFromDOM(f.rendered.container.querySelector(".cm-editor")!)).toBe(f.view);
  expect(f.view.state.doc.toString()).toBe("unsaved changes");
  const original = f.fixture.request.getMockImplementation()!;
  f.fixture.request.mockImplementation(async (request) => {
    if (request.method === "files.writeText") throw new Error("The disk is full.");
    return original(request);
  });
  f.save();
  await act(async () => {
    await vi.waitFor(() =>
      expect(f.rendered.getByRole("alert").textContent).toContain("disk is full"),
    );
  });
  expect(EditorView.findFromDOM(f.rendered.container.querySelector(".cm-editor")!)).toBe(f.view);
  act(() => {
    expect(undo(f.view)).toBe(true);
  });
  expect(f.view.state.doc.toString()).not.toBe("unsaved changes");
});

it("shows an opening error instead of an editor for a file that never loaded", async () => {
  const f = await mount();
  act(() => {
    f.runtime.store.getState().patchBuffer(f.project.root, f.path, {
      loaded: false,
      contents: "",
      savedContents: "",
      error: "No access.",
    });
  });
  expect(f.rendered.container.querySelector(".cm-editor")).toBeNull();
  expect(f.rendered.getByText(`Could not open ${f.fixture.file.name}`)).toBeTruthy();
});

it("defers disk refresh while the live editor has not yet flushed its debounced contents", async () => {
  const f = await mount();
  const originalContents = f.buffer().contents;
  f.replace("typing before the debounce");
  expect(f.buffer().contents).toBe(originalContents);
  f.fixture.file.text = "a concurrent disk edit";
  await act(async () => {
    await f.runtime.refresh(f.project.root);
  });
  expect(f.view.state.doc.toString()).toBe("typing before the debounce");
  await act(async () => {
    await vi.waitFor(() => expect(f.buffer().error).toContain("changed on disk"));
  });
  expect(f.buffer().contents).toBe("typing before the debounce");
  expect(f.view.state.doc.toString()).toBe("typing before the debounce");
});

it("does not overwrite typing that starts while a disk read is in flight", async () => {
  const f = await mount();
  const original = f.fixture.request.getMockImplementation()!;
  let finish!: () => void;
  f.fixture.request.mockImplementationOnce(original);
  f.fixture.request.mockImplementation(async (request) => {
    const result = await original(request);
    if (request.method === "files.readText") {
      f.fixture.request.mockImplementation(original);
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    }
    return result;
  });
  f.fixture.file.text = "external changes";
  const refreshing = f.runtime.refresh(f.project.root);
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  f.replace("typed during the read");
  await act(async () => {
    finish();
    await refreshing;
  });
  expect(f.view.state.doc.toString()).toBe("typed during the read");
  await act(async () => {
    await vi.waitFor(() => expect(f.buffer().error).toContain("changed on disk"));
  });
  expect(f.buffer().contents).toBe("typed during the read");
});
