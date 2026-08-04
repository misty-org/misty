import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpacesUtilityTray } from "@/features/spaces/components/SpacesUtilityTray";

describe("SpacesUtilityTray", () => {
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

  it("launches a fresh top-level tab for the selected tool", async () => {
    const onOpenTool = vi.fn();
    await act(async () => root.render(<SpacesUtilityTray onOpenTool={onOpenTool} />));

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="Open File Manager"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      container
        .querySelector<HTMLButtonElement>('[aria-label="Open File Manager"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onOpenTool).toHaveBeenNthCalledWith(1, "file-manager");
    expect(onOpenTool).toHaveBeenNthCalledWith(2, "file-manager");
    expect(
      container.querySelector('[aria-label="Open File Manager"] .lucide-folder-open'),
    ).not.toBeNull();
    expect(container.querySelector('[aria-label*="terminal" i]')).toBeNull();
  });
});
