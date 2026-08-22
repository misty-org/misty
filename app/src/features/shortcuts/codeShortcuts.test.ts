import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsStore } from "@/features/settings/store/useSettingsStore";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import { parseShortcut } from "./bindings";
import { defaultBindingsFor, shortcutCommandRegistry, type ShortcutPlatform } from "./registry";
import { dispatchShortcutEvent, registerShortcutHandler } from "./runtime";

const platforms: ShortcutPlatform[] = ["macos", "windows", "linux"];

describe("Code shortcut dispatch", () => {
  beforeEach(() => {
    useWorkspaceStore.persist.clearStorage();
    useWorkspaceStore.getState().reset();
    useWorkspaceStore.getState().openSurface({
      surfaceId: "code",
      groupKey: "tool:code",
      title: "Code",
      route: "/code",
      instancePolicy: "multiple",
      forceNew: true,
    });
  });

  afterEach(() => {
    document.documentElement.removeAttribute("data-shortcut-capture");
    useSettingsStore.setState({ shortcuts: null });
  });

  for (const platform of platforms) {
    it(`dispatches every ${platform} Code binding while the editor is focused`, () => {
      installShortcutSnapshot(platform);
      const editor = document.createElement("div");
      editor.className = "cm-editor";
      document.body.append(editor);

      for (const definition of codeDefinitions()) {
        const binding = defaultBindingsFor(definition, platform).primary;
        expect(binding, `${definition.id} needs a ${platform} default`).toBeTruthy();
        const handler = vi.fn();
        const unregister = registerShortcutHandler(definition.id, handler);
        const event = keyboardEvent(binding!);
        Object.defineProperty(event, "target", { configurable: true, value: editor });

        expect(dispatchShortcutEvent(event), definition.id).toBe(true);
        expect(handler, definition.id).toHaveBeenCalledOnce();
        unregister();
      }

      editor.remove();
    });
  }

  it("keeps the global palette and launcher shadowable by focused Code commands", () => {
    const commandPalette = codeDefinitions().find(
      (definition) => definition.id === "code.command_palette",
    );
    const inlineAi = codeDefinitions().find((definition) => definition.id === "code.inline_ai");
    expect(commandPalette?.allowShadowing).toBe(true);
    expect(inlineAi?.allowShadowing).toBe(true);
  });
});

function codeDefinitions() {
  return shortcutCommandRegistry.filter((definition) => definition.scope === "tool:code");
}

function installShortcutSnapshot(platform: ShortcutPlatform) {
  const effectiveBindings = shortcutCommandRegistry.map((definition) => ({
    commandId: definition.id,
    ...defaultBindingsFor(definition, platform),
    primarySource: "default" as const,
    alternateSource: "default" as const,
  }));
  useSettingsStore.setState({
    shortcuts: {
      detectedPlatform: platform,
      profileName: platform,
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

function keyboardEvent(binding: string): KeyboardEvent {
  const parsed = parseShortcut(binding);
  if (!parsed) throw new Error(`Invalid test binding: ${binding}`);
  const { key, code } = eventKey(parsed.key);
  return new KeyboardEvent("keydown", {
    key,
    code,
    altKey: parsed.alt,
    ctrlKey: parsed.ctrl,
    metaKey: parsed.meta,
    shiftKey: parsed.shift,
    bubbles: true,
    cancelable: true,
  });
}

function eventKey(key: string): { key: string; code: string } {
  if (/^[a-z]$/.test(key)) return { key, code: `Key${key.toUpperCase()}` };
  if (/^[0-9]$/.test(key)) return { key, code: `Digit${key}` };
  if (/^f\d{1,2}$/.test(key)) return { key: key.toUpperCase(), code: key.toUpperCase() };
  const named: Record<string, { key: string; code: string }> = {
    arrowdown: { key: "ArrowDown", code: "ArrowDown" },
    arrowup: { key: "ArrowUp", code: "ArrowUp" },
    enter: { key: "Enter", code: "Enter" },
    grave: { key: "`", code: "Backquote" },
    period: { key: ".", code: "Period" },
  };
  const result = named[key];
  if (!result) throw new Error(`Missing keyboard-event mapping for ${key}`);
  return result;
}
