import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { command } from "@/features/shortcuts/factory";
import type { ShortcutsSnapshot } from "@/native/contracts";
import type { SettingsContentProps } from "../settingsTypes";
import { ShortcutsSection } from "./ShortcutsSection";

const definitions = [
  command("test.first", "First action", {
    description: "The first test action.",
    category: "Testing",
    mac: "Cmd+K",
    windows: "Ctrl+K",
  }),
  command("test.second", "Second action", {
    description: "The second test action.",
    category: "Testing",
  }),
  command("test.terminal", "Terminal action", {
    description: "A scoped terminal test action.",
    category: "Terminal",
    scope: "tool:terminal",
    mac: "Cmd+J",
    windows: "Ctrl+J",
  }),
];

const snapshot: ShortcutsSnapshot = {
  detectedPlatform: "macos",
  profileName: "macOS",
  commandDefinitions: definitions,
  effectiveBindings: [
    {
      commandId: "test.first",
      primary: "Cmd+K",
      alternate: null,
      primarySource: "default",
      alternateSource: "default",
    },
    {
      commandId: "test.second",
      primary: null,
      alternate: null,
      primarySource: "default",
      alternateSource: "default",
    },
    {
      commandId: "test.terminal",
      primary: "Cmd+J",
      alternate: null,
      primarySource: "default",
      alternateSource: "default",
    },
  ],
  bindings: [],
  configPath: "/tmp/commands.msy",
  overrides: [],
};

describe("ShortcutsSection", () => {
  let container: HTMLDivElement;
  let root: Root;
  let props: SettingsContentProps;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    props = {
      document: {},
      launchOnLogin: null,
      working: false,
      onSettingChange: vi.fn(),
      onLoad: vi.fn(async () => undefined),
      onShortcutChange: vi.fn(async () => undefined),
      onShortcutReassign: vi.fn(async () => undefined),
      onResetShortcuts: vi.fn(async () => undefined),
      onRemoveOpenWithAssociation: vi.fn(async () => undefined),
      shortcuts: snapshot,
      openWithAssociations: [],
      app: null,
    };
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    delete document.documentElement.dataset.shortcutCapture;
  });

  async function render() {
    await act(async () => root.render(<ShortcutsSection {...props} />));
  }

  it("records conflicts and offers one atomic reassignment", async () => {
    await render();
    const slot = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Primary shortcut: unbound"]',
    );
    expect(slot).not.toBeNull();

    await act(async () => slot?.click());
    await act(async () => {
      slot?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "k",
          code: "KeyK",
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(container.textContent).toContain("already used by First action");
    const reassign = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Reassign",
    );
    await act(async () => reassign?.click());
    expect(props.onShortcutReassign).toHaveBeenCalledWith({
      commandId: "test.second",
      slot: "primary",
      value: "Cmd+K",
      conflictingCommandId: "test.first",
      conflictingSlot: "primary",
    });
  });

  it("searches descriptions and effective binding text while rendering native keycaps", async () => {
    await render();
    expect(container.textContent).toContain("⌘");
    const search = container.querySelector<HTMLInputElement>(
      'input[placeholder="Search commands, tools, or shortcuts"]',
    );
    await act(async () => {
      if (!search) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        search,
        "Cmd+J",
      );
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.textContent).toContain("Terminal action");
    expect(container.textContent).not.toContain("First action");
  });
});
