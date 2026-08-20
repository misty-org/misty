import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsStore } from "@/features/settings/store/useSettingsStore";
import { defaultBindingsFor, shortcutCommandRegistry, ShortcutRuntime } from "@/features/shortcuts";
import {
  createCodeTabState,
  useWorkspaceStore,
  type CodeMultibufferSpec,
} from "@/features/workspace";
import { useCodingWorkspaceStore } from "../store/useCodingWorkspaceStore";
import { CodeMultibuffer } from "./CodeMultibuffer";

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
}));

vi.mock("../native", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  codeFindInFiles: nativeMocks.codeFindInFiles,
}));

describe("Code multibuffer shortcuts", () => {
  beforeAll(() => {
    Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
    Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
  });

  beforeEach(() => {
    installMacShortcuts();
    useWorkspaceStore.persist.clearStorage();
    useWorkspaceStore.getState().reset();
    useCodingWorkspaceStore.persist.clearStorage();
    useCodingWorkspaceStore.setState({ projectBuffers: {}, views: {}, projects: {} });
  });

  afterEach(() => {
    cleanup();
    useSettingsStore.setState({ shortcuts: null });
  });

  it("opens the selected excerpt in a global Code tab with Option+Enter", async () => {
    const spec: CodeMultibufferSpec = {
      id: "search:answer",
      kind: "search",
      title: "Search: answer",
      query: "answer",
      caseSensitive: false,
    };
    const tab = useWorkspaceStore.getState().openSurface({
      surfaceId: "code",
      groupKey: "tool:code",
      title: spec.title,
      route: "/code",
      instancePolicy: "multiple",
      forceNew: true,
      state: createCodeTabState({ rootPath: "/project", viewport: { kind: "multibuffer", spec } }),
    });
    useCodingWorkspaceStore.getState().ensureBuffer("/project", {
      path: "/project/example.ts",
      name: "example.ts",
      contents: "const answer = 42;\n",
      savedContents: "const answer = 42;\n",
      lineEnding: "lf",
      readonly: false,
      loading: false,
      error: null,
    });
    const onOpenFileInNewTab = vi.fn();
    render(
      <>
        <ShortcutRuntime />
        <CodeMultibuffer
          viewId={tab.id}
          rootPath="/project"
          spec={spec}
          onOpenFile={vi.fn()}
          onOpenFileInNewTab={onOpenFileInNewTab}
        />
      </>,
    );
    const editor = await waitFor(() => {
      const value = document.querySelector<HTMLElement>(".cm-content");
      if (!value) throw new Error("Multibuffer editor did not mount");
      return value;
    });
    editor.focus();

    fireEvent.keyDown(editor, {
      key: "Enter",
      code: "Enter",
      altKey: true,
      bubbles: true,
      cancelable: true,
    });

    await waitFor(() =>
      expect(onOpenFileInNewTab).toHaveBeenCalledWith("/project/example.ts", "example.ts", 1),
    );
  });
});

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
