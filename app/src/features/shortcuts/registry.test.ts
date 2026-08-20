import { describe, expect, it } from "vitest";
import { normalizeShortcut, scopesOverlap } from "./bindings";
import { shortcutCommandRegistry, shortcutCommandsById } from "./registry";

describe("shortcut platform defaults", () => {
  it("uses native primary modifiers for shell navigation", () => {
    const launcher = shortcutCommandsById.get("search.toggle")!;
    const nextTab = shortcutCommandsById.get("workspace.next_tab")!;
    expect(launcher.defaults.macos.primary).toBe("Cmd+K");
    expect(launcher.defaults.windows.primary).toBe("Ctrl+K");
    expect(launcher.defaults.linux.primary).toBe("Ctrl+K");
    expect(nextTab.defaults.macos).toEqual({
      primary: "Cmd+Shift+RightBracket",
      alternate: "Ctrl+Tab",
    });
    expect(nextTab.defaults.windows).toEqual({
      primary: "Ctrl+Tab",
      alternate: "Ctrl+PageDown",
    });
  });

  it("uses the curated Harpoon defaults", () => {
    const harpoon = shortcutCommandsById.get("code.harpoon")!;
    expect(harpoon.defaults.macos.primary).toBe("Cmd+Shift+E");
    expect(harpoon.defaults.windows.primary).toBe("Ctrl+E");
    expect(shortcutCommandsById.get("code.mark_1")?.defaults.macos.primary).toBe("Cmd+Option+1");
  });

  it("uses Vim directions for pane focus and numbered virtual windows", () => {
    expect(shortcutCommandsById.get("workspace.focus_pane_left")?.defaults.macos.primary).toBe(
      "Option+H",
    );
    expect(shortcutCommandsById.get("workspace.focus_pane_down")?.defaults.windows.primary).toBe(
      "Alt+J",
    );
    expect(shortcutCommandsById.get("workspace.window_1")?.defaults.macos.primary).toBe("Option+1");
    expect(shortcutCommandsById.get("workspace.window_9")?.defaults.windows.primary).toBe(
      "Ctrl+Alt+9",
    );
  });

  it("provides native-style virtual window cycling and reopening", () => {
    expect(shortcutCommandsById.get("workspace.next_virtual_window")?.defaults.macos.primary).toBe(
      "Cmd+Grave",
    );
    expect(shortcutCommandsById.get("workspace.next_virtual_window")?.defaults.windows).toEqual({
      primary: "Ctrl+Alt+Grave",
      alternate: "Ctrl+Shift+PageDown",
    });
    expect(
      shortcutCommandsById.get("workspace.reopen_virtual_window")?.defaults.macos.primary,
    ).toBe("Cmd+Option+Shift+W");
  });

  it("never assigns Command/Windows-key defaults on Windows or Linux", () => {
    for (const definition of shortcutCommandRegistry) {
      for (const platform of ["windows", "linux"] as const) {
        expect(definition.defaults[platform].primary ?? "").not.toContain("Cmd");
        expect(definition.defaults[platform].alternate ?? "").not.toContain("Cmd");
      }
    }
  });

  it("has no ambiguous defaults in an overlapping context", () => {
    for (const platform of ["macos", "windows", "linux"] as const) {
      const assigned = shortcutCommandRegistry.flatMap((definition) =>
        [definition.defaults[platform].primary, definition.defaults[platform].alternate]
          .map(normalizeShortcut)
          .filter((binding): binding is string => Boolean(binding))
          .map((binding) => ({ binding, definition })),
      );
      for (let leftIndex = 0; leftIndex < assigned.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < assigned.length; rightIndex += 1) {
          const left = assigned[leftIndex];
          const right = assigned[rightIndex];
          if (left.definition.id === right.definition.id || left.binding !== right.binding)
            continue;
          if (!scopesOverlap(left.definition.scope, right.definition.scope)) continue;
          const contextualShadow =
            left.definition.scope !== right.definition.scope &&
            (left.definition.allowShadowing || right.definition.allowShadowing);
          expect(
            contextualShadow,
            `${platform}: ${left.definition.id} / ${right.definition.id}`,
          ).toBe(true);
        }
      }
    }
  });
});
