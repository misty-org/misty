import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../FilePicker", () => ({
  MistyFilePicker: ({ active }: { active?: boolean }) => (
    <div data-testid="files-panel" data-active={active ? "true" : "false"} />
  ),
}));

vi.mock("@/features/space-library", () => ({
  MistyLibraryPicker: ({ active }: { active?: boolean }) => (
    <div data-testid="library-panel" data-active={active ? "true" : "false"} />
  ),
}));

import { MistyPicker } from "../MistyPicker";

describe("MistyPicker", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("keeps one dialog and both source panels mounted while switching", async () => {
    await act(async () => {
      root.render(
        <MistyPicker
          spaceId="space-1"
          onCancel={vi.fn()}
          onChooseFiles={vi.fn()}
          onChooseLibraryItems={vi.fn()}
        />,
      );
    });

    const dialog = document.body.querySelector<HTMLElement>('[data-slot="dialog-content"]');
    const libraryButton = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>('[data-slot="toggle-group-item"]'),
    ).find((button) => button.textContent?.includes("Library"));
    expect(document.body.querySelectorAll('[data-slot="dialog-content"]')).toHaveLength(1);
    expect(document.body.querySelector('[data-testid="files-panel"]')).not.toBeNull();
    expect(document.body.querySelector('[data-testid="library-panel"]')).not.toBeNull();

    await act(async () => libraryButton?.click());

    expect(document.body.querySelector('[data-slot="dialog-content"]')).toBe(dialog);
    expect(
      document.body.querySelector('[data-testid="library-panel"]')?.getAttribute("data-active"),
    ).toBe("true");
  });
});
