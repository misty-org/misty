import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsStore } from "@/features/settings/store/useSettingsStore";
import {
  defaultBindingsFor,
  invokeShortcutCommand,
  shortcutCommandRegistry,
  ShortcutRuntime,
} from "@/features/shortcuts";
import { createCodeTabState, useWorkspaceStore, type WorkspaceTab } from "@/features/workspace";
import { useCodingWorkspaceStore } from "./store/useCodingWorkspaceStore";
import { CodingWorkspace } from "./CodingWorkspace";

const lspMocks = vi.hoisted(() => ({
  codeActions: vi.fn(async () => []),
  documentSymbols: vi.fn(async () => [
    {
      name: "answer",
      kind: 13,
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 17 } },
      selectionRange: { start: { line: 0, character: 6 }, end: { line: 0, character: 12 } },
    },
  ]),
  formatDocument: vi.fn(async () => true),
  goToDefinition: vi.fn(async () => true),
  showSymbolInformation: vi.fn(async () => true),
}));
const nativeMocks = vi.hoisted(() => ({
  codeFindInFiles: vi.fn(async () => ({
    matches: [
      {
        path: "/project/example.ts",
        relative: "example.ts",
        lineNumber: 1,
        line: "const answer = 42;",
        column: 6,
      },
    ],
    truncated: false,
    usedRipgrep: true,
  })),
  codeWalkFiles: vi.fn(async () => [
    { path: "/project/example.ts", relative: "example.ts", name: "example.ts" },
  ]),
  codeWriteTextFile: vi.fn(async () => ({ sizeBytes: 19, modifiedMs: 1 })),
}));

vi.mock("./lsp/codeMirrorLsp", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    codeActions: lspMocks.codeActions,
    documentSymbols: lspMocks.documentSymbols,
    formatDocument: lspMocks.formatDocument,
    goToDefinition: lspMocks.goToDefinition,
    lspExtension: () => [],
    showSymbolInformation: lspMocks.showSymbolInformation,
  };
});

vi.mock("./components/CodeExplorer", () => ({
  CodeExplorer: () => <div data-testid="code-explorer" />,
}));

vi.mock("./watcher/useFileWatcher", () => ({ useFileWatcher: () => undefined }));

vi.mock("./native", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  codeFindInFiles: nativeMocks.codeFindInFiles,
  codeWalkFiles: nativeMocks.codeWalkFiles,
  codeWriteTextFile: nativeMocks.codeWriteTextFile,
}));

vi.mock("react-resizable-panels", async () => {
  const React = await import("react");
  const Panel = React.forwardRef(function TestPanel(
    props: React.PropsWithChildren,
    ref: React.ForwardedRef<{
      collapse: () => void;
      expand: () => void;
      isCollapsed: () => boolean;
    }>,
  ) {
    React.useImperativeHandle(ref, () => ({
      collapse: () => undefined,
      expand: () => undefined,
      isCollapsed: () => false,
    }));
    return <div>{props.children}</div>;
  });
  return {
    Panel,
    PanelGroup: (props: React.PropsWithChildren) => <div>{props.children}</div>,
    PanelResizeHandle: () => <div />,
  };
});

describe("CodingWorkspace shortcut integration", () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
    Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
    Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
  });

  beforeEach(() => {
    installMacShortcuts();
    useWorkspaceStore.persist.clearStorage();
    useWorkspaceStore.getState().reset();
    useCodingWorkspaceStore.persist.clearStorage();
    useCodingWorkspaceStore.setState({ projectBuffers: {}, views: {}, projects: {} });
    lspMocks.codeActions.mockClear();
    lspMocks.documentSymbols.mockClear();
    lspMocks.formatDocument.mockClear();
    lspMocks.goToDefinition.mockClear();
    lspMocks.showSymbolInformation.mockClear();
  });

  afterEach(() => {
    cleanup();
    useSettingsStore.setState({ shortcuts: null });
  });

  it("opens the Code command palette from an editable CodeMirror target", async () => {
    renderWorkspace();
    const editor = await codeMirrorEditor();

    fireEvent.keyDown(editor, shortcutEvent("p", "KeyP", { metaKey: true, shiftKey: true }));

    expect(await screen.findByPlaceholderText("Run a command…")).toBeTruthy();
  });

  it("opens project search from an editable CodeMirror target", async () => {
    renderWorkspace();
    const editor = await codeMirrorEditor();

    fireEvent.keyDown(editor, shortcutEvent("f", "KeyF", { metaKey: true, shiftKey: true }));

    const search = await screen.findByPlaceholderText("Search project contents…");
    fireEvent.change(search, { target: { value: "answer" } });
    expect(await screen.findByText("Open 1 matches in a multibuffer")).toBeTruthy();
  });

  it("opens Inline AI with the scoped Cmd+K binding", async () => {
    renderWorkspace();
    await codeMirrorEditor();
    const commandCenter = screen.getByRole("button", { name: "Open file or command" });
    commandCenter.focus();

    fireEvent.keyDown(commandCenter, shortcutEvent("k", "KeyK", { metaKey: true }));

    expect(await screen.findByPlaceholderText(/Rewrite this/)).toBeTruthy();
  });

  it("opens document symbols instead of the general command list", async () => {
    renderWorkspace();
    const editor = await codeMirrorEditor();

    fireEvent.keyDown(editor, shortcutEvent("o", "KeyO", { metaKey: true, shiftKey: true }));

    expect(await screen.findByText("answer")).toBeTruthy();
    expect(lspMocks.documentSymbols).toHaveBeenCalled();
  });

  it("requests symbol information for the cursor", async () => {
    renderWorkspace();
    const editor = await codeMirrorEditor();
    editor.focus();

    fireEvent.keyDown(editor, shortcutEvent("i", "KeyI", { metaKey: true, shiftKey: true }));

    await waitFor(() => expect(lspMocks.showSymbolInformation).toHaveBeenCalledOnce());
  });

  it.each(
    shortcutCommandRegistry
      .filter((definition) => definition.scope === "tool:code")
      .map((definition) => definition.id)
      .filter(
        (commandId) =>
          commandId !== "code.apply_inline_ai" && commandId !== "code.open_multibuffer_excerpt",
      ),
  )("registers a live file-viewport handler for %s", async (commandId) => {
    renderWorkspace();
    const editor = await codeMirrorEditor();
    editor.focus();

    expect(invokeShortcutCommand(commandId)).toBe(true);
  });
});

function renderWorkspace() {
  const tab = createWorkspaceTab();
  render(
    <MemoryRouter>
      <ShortcutRuntime />
      <CodingWorkspace tab={tab} />
    </MemoryRouter>,
  );
  return tab;
}

function createWorkspaceTab(): WorkspaceTab {
  const rootPath = "/project";
  const path = "/project/example.ts";
  const tab = useWorkspaceStore.getState().openSurface({
    surfaceId: "code",
    groupKey: "tool:code",
    title: "example.ts",
    route: "/code",
    instancePolicy: "multiple",
    forceNew: true,
    state: createCodeTabState({ rootPath, activeFilePath: path }),
  });
  useCodingWorkspaceStore.getState().openFile(rootPath, tab.id, {
    path,
    name: "example.ts",
    contents: "const answer = 42;\n",
    savedContents: "const answer = 42;\n",
    lineEnding: "lf",
    readonly: false,
    loading: false,
    error: null,
  });
  return tab;
}

async function codeMirrorEditor() {
  return waitFor(() => {
    const editor = document.querySelector<HTMLElement>(".cm-content");
    if (!editor) throw new Error("CodeMirror did not mount");
    return editor;
  });
}

function installMacShortcuts() {
  const effectiveBindings = shortcutCommandRegistry.map((definition) => ({
    commandId: definition.id,
    ...defaultBindingsFor(definition, "macos"),
    primarySource: "default" as const,
    alternateSource: "default" as const,
  }));
  useSettingsStore.setState({
    shortcuts: {
      detectedPlatform: "macos",
      profileName: "macOS",
      commandDefinitions: [...shortcutCommandRegistry],
      effectiveBindings,
      bindings: effectiveBindings.flatMap((binding) =>
        binding.primary
          ? [
              {
                commandId: binding.commandId,
                shortcut: binding.primary,
                source: "default" as const,
              },
            ]
          : [],
      ),
      configPath: "",
      overrides: [],
    },
  });
}

function shortcutEvent(
  key: string,
  code: string,
  modifiers: Pick<KeyboardEventInit, "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
) {
  return { key, code, bubbles: true, cancelable: true, ...modifiers };
}
