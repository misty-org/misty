// Run the real browser implementation; the package's Node/SSR export intentionally omits panel registration.
vi.mock("react-resizable-panels", async () =>
  vi.importActual(
    "../../../node_modules/react-resizable-panels/dist/react-resizable-panels.browser.development.esm.js",
  ),
);
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { useEffect } from "react";
import { create } from "zustand";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { createCodeTabState, type WorkspaceTab } from "@/features/workspace/model";
import { dockLeaves, mapDockTabs, createDockLeaf } from "@/features/workspace/dockTree";
import { selectEditorPreferences } from "@/features/settings/store/preferences";
import type { CodeWorkspaceState } from "./codeWorkspaceServices";
import { createSdkCodeFileFixture } from "./sdkCodeProject.fixture";
import { createSdkCodeRuntime } from "./sdkCodeRuntime";
import { createSdkCodeEditor } from "./components/createSdkCodeEditor";
import { createSdkCodingWorkspace } from "./createSdkCodingWorkspace";
import { useCodeOverlayAppearance } from "./useCodeOverlayAppearance";

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Element.prototype.scrollIntoView = vi.fn();
});
const disposals: Array<() => Promise<void>> = [];
afterEach(async () => {
  cleanup();
  for (const dispose of disposals.splice(0)) await dispose();
});
async function mount() {
  const fixture = createSdkCodeFileFixture();
  fixture.root.children!.set("second.ts", {
    name: "second.ts",
    kind: "file",
    text: "second document\n",
  });
  const runtime = createSdkCodeRuntime(fixture.sdk),
    project = (await runtime.openProject())!;
  const path = `${project.root}/src/${fixture.file.name}`;
  await runtime.openFile(project.root, path, "same-view");
  const tab: WorkspaceTab = {
    id: "same-view",
    surfaceId: "code",
    groupKey: "tool:code",
    instanceKey: "code",
    title: fixture.file.name,
    route: "/apps/code",
    sidebarVisible: true,
    state: createCodeTabState({ rootPath: project.root, activeFilePath: path }),
    createdAt: 0,
    lastFocusedAt: 0,
  };
  const pane = createDockLeaf([tab]);
  const dock = vi.fn(() => true);
  const workspace = create<CodeWorkspaceState>((set, get) => {
    const patch = (id: string, change: Partial<WorkspaceTab>) =>
      set((state) => ({
        layout: {
          ...state.layout,
          root: mapDockTabs(state.layout.root, (t) => (t.id === id ? { ...t, ...change } : t)),
        },
      }));
    return {
      activeScopeKey: "space:test",
      layout: { root: pane, focusedPaneId: pane.id },
      updateTabState: (id, state, title) => patch(id, { state, ...(title ? { title } : {}) }),
      renameTab: (id, title) => patch(id, { title }),
      toggleSidebar: (id) => {
        const current = dockLeaves(get().layout.root)
          .flatMap((p) => p.tabs)
          .find((t) => t.id === id)!;
        patch(id, { sidebarVisible: !current.sidebarVisible });
      },
      focusTab: (id) => {
        set((state) => ({
          layout: {
            ...state.layout,
            root: { ...dockLeaves(state.layout.root)[0], activeTabId: id },
          },
        }));
        return true;
      },
      closeTab: (id) => {
        set((state) => ({
          layout: {
            ...state.layout,
            root: {
              ...dockLeaves(state.layout.root)[0],
              tabs: dockLeaves(state.layout.root)[0].tabs.filter((t) => t.id !== id),
            },
          },
        }));
        return true;
      },
      dockTab: dock,
      openSurface: (input) => {
        const next = {
          ...tab,
          ...input,
          id: `new-${crypto.randomUUID()}`,
          instanceKey: input.instanceKey ?? "code",
          sidebarVisible: input.sidebarVisible ?? true,
        } as WorkspaceTab;
        set((state) => ({
          layout: {
            ...state.layout,
            root: {
              ...dockLeaves(state.layout.root)[0],
              tabs: [...dockLeaves(state.layout.root)[0].tabs, next],
            },
          },
        }));
        return next;
      },
    };
  });
  const events = new EventTarget(),
    preferences = { ...selectEditorPreferences(null), autosaveDelayMs: 0 };
  const shortcuts = new Map<string, { run: () => unknown; active: () => boolean }>();
  const register = (id: string, run: () => unknown, active: () => boolean = () => true) => {
    shortcuts.set(id, { run, active });
    return () => {
      shortcuts.delete(id);
    };
  };
  const editor = createSdkCodeEditor(runtime, {
    events,
    usePreferences: () => preferences,
    useShortcutHandler: (id, run, active) =>
      useEffect(() => register(id, run, active), [id, run, active]),
    ErrorActivity: ({ error }) => <div role="alert">{error}</div>,
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
  const documentSymbolsForEditor = vi.fn(editor.documentSymbolsForEditor);
  const report = vi.fn();
  const controller = createSdkCodingWorkspace(runtime, {
    ...editor,
    documentSymbolsForEditor,
    workspace,
    events,
    usePreferences: () => preferences,
    useOverlayAppearance: useCodeOverlayAppearance,
    useShortcutTitle: (label) => label,
    registerShortcutHandler: register,
    updatePreference: vi.fn(),
    ShortcutHint: () => null,
    FolderPicker: () => null,
    ErrorActivity: ({ error }) => <div role="alert">{error}</div>,
    openModelsSettings: vi.fn(),
    report,
    retainLspRoot: () => () => undefined,
    findReferencesAt: async () => [],
    useCodeAiAdapter: () => undefined,
    InlineRewrite: () => null,
  });
  function Surface() {
    const current = workspace((state) =>
      dockLeaves(state.layout.root)
        .flatMap((p) => p.tabs)
        .find((t) => t.id === tab.id),
    );
    return <controller.Workspace tab={current} />;
  }
  const rendered = render(<Surface />),
    ui = within(rendered.container);
  disposals.push(async () => {
    controller.close();
    editor.close();
    await runtime.close();
  });
  const run = (id: string) =>
    act(() => {
      const handler = shortcuts.get(id)!;
      expect(handler.active()).toBe(true);
      handler.run();
    });
  return {
    fixture,
    runtime,
    project,
    path,
    workspace,
    events,
    rendered,
    ui,
    editor,
    controller,
    shortcuts,
    documentSymbolsForEditor,
    report,
    run,
    dock,
  };
}

it("assembles the full explorer/editor/status UI around separate SDK runtimes", async () => {
  const first = await mount(),
    second = await mount();
  expect(first.ui.getByRole("button", { name: "src" })).toBeTruthy();
  const view = EditorView.findFromDOM(first.rendered.container.querySelector(".cm-editor")!)!;
  expect(view.state.doc.toString()).toBe(first.fixture.file.text!.replace(/\r\n/g, "\n"));
  act(() => {
    view.focus();
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "saved through SDK" } });
  });
  first.run("code.save");
  await act(async () => {
    await vi.waitFor(() => expect(first.fixture.file.text).toBe("saved through SDK"));
  });
  expect(second.fixture.file.text).not.toBe("saved through SDK");
  act(() =>
    first.runtime.editor.getState().setProjectDiagnostics(first.project.root, first.path, [
      {
        path: first.path,
        fromLine: 0,
        fromCharacter: 0,
        toLine: 0,
        toCharacter: 1,
        severity: "error",
        message: "fixture",
      },
    ]),
  );
  expect(first.ui.getByRole("button", { name: "Errors: 1" })).toBeTruthy();
  expect(second.ui.getByRole("button", { name: "Errors: 0" })).toBeTruthy();
});

it("uses owned navigation events and preserves Code file history", async () => {
  const first = await mount(),
    second = await mount();
  const path = `${first.project.root}/second.ts`;
  act(() =>
    first.events.dispatchEvent(
      new CustomEvent("misty:code-open-file", { detail: { path, viewId: "same-view" } }),
    ),
  );
  await act(async () => {
    await vi.waitFor(() => expect(first.editor.editorLocation("same-view")?.path).toBe(path));
  });
  expect(second.editor.editorLocation("same-view")?.path).toBe(second.path);
  first.run("navigation.back");
  await act(async () => {
    await vi.waitFor(() => expect(first.editor.editorLocation("same-view")?.path).toBe(first.path));
  });
  first.rendered.unmount();
  expect(first.shortcuts.size).toBe(0);
  expect(document.documentElement.dataset.codeOverlayTheme).toBeDefined();
  const before = first.runtime.store.getState();
  first.events.dispatchEvent(
    new CustomEvent("misty:code-open-file", { detail: { path, viewId: "same-view" } }),
  );
  expect(first.runtime.store.getState()).toBe(before);
});

it("opens search review tabs and keeps the original file view intact", async () => {
  const f = await mount();
  f.run("code.search_project");
  fireEvent.change(f.ui.getByPlaceholderText("Search project contents…"), {
    target: { value: "value" },
  });
  fireEvent.click(await f.ui.findByRole("option", { name: /Open .* matches in a multibuffer/ }));
  const tabs = dockLeaves(f.workspace.getState().layout.root).flatMap((p) => p.tabs);
  expect(tabs).toHaveLength(2);
  expect(tabs[0].state).toMatchObject({ viewport: { activeFilePath: f.path } });
  expect(tabs[1].state).toMatchObject({
    rootPath: f.project.root,
    viewport: { kind: "multibuffer", spec: { kind: "search", query: "value" } },
  });
});

it("ignores an outline response for the previous file", async () => {
  const f = await mount();
  let finish!: (symbols: Awaited<ReturnType<typeof f.documentSymbolsForEditor>>) => void;
  f.documentSymbolsForEditor.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  f.run("code.document_symbols");
  act(() =>
    f.events.dispatchEvent(
      new CustomEvent("misty:code-open-file", {
        detail: { path: `${f.project.root}/second.ts`, viewId: "same-view" },
      }),
    ),
  );
  await act(async () => {
    await vi.waitFor(() =>
      expect(f.editor.editorLocation("same-view")?.path).toContain("second.ts"),
    );
  });
  await act(async () =>
    finish([
      {
        name: "staleSymbol",
        kind: 12,
        range: { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } },
        selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      },
    ]),
  );
  expect(f.ui.queryByText("staleSymbol")).toBeNull();
});

it("collapses and restores the real explorer panel through workspace controls", async () => {
  const f = await mount();
  const panel = f.rendered.container.querySelector('[data-panel-collapsible="true"]')!;
  expect(panel).toBeTruthy();
  expect(Number(panel.getAttribute("data-panel-size"))).toBeGreaterThan(0);
  f.run("code.toggle_explorer");
  await vi.waitFor(() => expect(Number(panel.getAttribute("data-panel-size"))).toBe(0));
  f.run("code.toggle_explorer");
  await vi.waitFor(() => expect(Number(panel.getAttribute("data-panel-size"))).toBeGreaterThan(0));
});
