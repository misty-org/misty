import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsStore } from "@/features/settings/store/useSettingsStore";
import { defaultBindingsFor, shortcutCommandRegistry, ShortcutRuntime } from "@/features/shortcuts";
import { useWorkspaceStore } from "@/features/workspace";
import { InlineRewrite } from "./InlineRewrite";

const aiMocks = vi.hoisted(() => ({
  readApiKey: vi.fn(async () => "test-key"),
  streamRewrite: vi.fn(
    async (options: { onDelta: (delta: string) => void; signal: AbortSignal }) => {
      if (!options.signal.aborted) options.onDelta("const answer = 43;");
    },
  ),
}));

vi.mock("./keychain", () => ({ readApiKey: aiMocks.readApiKey }));
vi.mock("./providers", () => ({ streamRewrite: aiMocks.streamRewrite }));
vi.mock("./useAiSettings", () => ({
  useAiSettings: () => ({
    providerId: "openai",
    baseUrl: "https://example.test",
    model: "test-model",
  }),
}));

describe("Inline AI apply shortcut", () => {
  beforeEach(() => {
    installMacShortcuts();
    useWorkspaceStore.persist.clearStorage();
    useWorkspaceStore.getState().reset();
    useWorkspaceStore.getState().openSurface({
      surfaceId: "code",
      groupKey: "tool:code",
      title: "example.ts",
      route: "/code",
      instancePolicy: "multiple",
      forceNew: true,
    });
    aiMocks.readApiKey.mockClear();
    aiMocks.streamRewrite.mockClear();
  });

  afterEach(() => {
    cleanup();
    useSettingsStore.setState({ shortcuts: null });
  });

  it("applies a completed preview with Cmd+Enter from the instruction field", async () => {
    const onApply = vi.fn();
    const onClose = vi.fn();
    render(
      <>
        <ShortcutRuntime />
        <InlineRewrite
          open
          selection="const answer = 42;"
          language="typescript"
          filename="example.ts"
          onApply={onApply}
          onClose={onClose}
          onOpenSettings={vi.fn()}
        />
      </>,
    );
    const input = screen.getByPlaceholderText(/Rewrite this/) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "increment the answer" } });
    fireEvent.submit(input.closest("form")!);
    expect(await screen.findByText("const answer = 43;")).toBeTruthy();

    fireEvent.keyDown(input, {
      key: "Enter",
      code: "Enter",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });

    await waitFor(() => expect(onApply).toHaveBeenCalledWith("const answer = 43;"));
    expect(onClose).toHaveBeenCalledOnce();
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
