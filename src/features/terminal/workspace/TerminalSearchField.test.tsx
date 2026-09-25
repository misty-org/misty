import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalSearchField } from "./TerminalSearchField";

describe("TerminalSearchField", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("shows the shortcut when idle and the active match when searching", async () => {
    await render({ value: "", resultIndex: -1, resultCount: 0 });
    expect(container.textContent).toContain("⌘F");

    await render({ value: "ready", resultIndex: 1, resultCount: 7 });
    expect(container.textContent).toContain("2/7");
    expect(container.textContent).not.toContain("⌘F");
  });

  it("navigates in both directions and dismisses with Escape", async () => {
    const onNavigate = vi.fn();
    const onDismiss = vi.fn();
    await render({ value: "ready", resultIndex: 0, resultCount: 2, onNavigate, onDismiss });
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Find in terminal"]');
    expect(input).not.toBeNull();

    await keyDown(input!, "Enter");
    await keyDown(input!, "Enter", { shiftKey: true });
    await keyDown(input!, "Escape");

    expect(onNavigate).toHaveBeenNthCalledWith(1, "next");
    expect(onNavigate).toHaveBeenNthCalledWith(2, "previous");
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  async function render(options: {
    value: string;
    resultIndex: number;
    resultCount: number;
    onNavigate?: (direction: "next" | "previous") => void;
    onDismiss?: () => void;
  }) {
    await act(async () => {
      root.render(
        <TerminalSearchField
          value={options.value}
          result={{ resultIndex: options.resultIndex, resultCount: options.resultCount }}
          shortcutLabel="⌘F"
          onChange={() => undefined}
          onNavigate={options.onNavigate ?? (() => undefined)}
          onDismiss={options.onDismiss ?? (() => undefined)}
        />,
      );
    });
  }
});

async function keyDown(
  input: HTMLInputElement,
  key: string,
  init: Pick<KeyboardEventInit, "shiftKey"> = {},
) {
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }));
  });
}
