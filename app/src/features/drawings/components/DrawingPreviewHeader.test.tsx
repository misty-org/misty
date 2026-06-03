import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpaceDrawing } from "../types";
import { DrawingPreviewHeader } from "./DrawingPreviewHeader";

vi.mock("@/features/activity", () => ({
  reportSystemError: vi.fn(),
}));

describe("DrawingPreviewHeader", () => {
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
    document.body.innerHTML = "";
  });

  it("moves rename and delete into the title menu and renames inline", async () => {
    const onRename = vi.fn(async () => undefined);
    const onDelete = vi.fn();
    const onOpen = vi.fn();
    await act(async () => {
      root.render(
        <DrawingPreviewHeader
          drawing={drawingFixture()}
          onRename={onRename}
          onDelete={onDelete}
          onOpen={onOpen}
        />,
      );
    });

    expect(container.querySelector("h2")?.textContent).toBe("Home Drawing");
    const openButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Open Home Drawing"]',
    );
    expect(openButton?.dataset.variant).toBe("default");
    expect(openButton?.querySelector('[data-icon="inline-end"]')).not.toBeNull();
    await act(async () => openButton?.click());
    expect(onOpen).toHaveBeenCalledOnce();

    const actions = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Actions for Home Drawing"]',
    );
    await act(async () => {
      actions?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    });
    expect(document.body.textContent).toContain("Rename");
    expect(document.body.textContent).toContain("Delete");

    const renameItem = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
      (item) => item.textContent?.includes("Rename"),
    );
    await act(async () => renameItem?.click());

    const input = container.querySelector<HTMLInputElement>('input[aria-label="Drawing title"]');
    expect(input?.value).toBe("Home Drawing");
    await act(async () => {
      if (!input) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        input,
        "Misty system design",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input?.form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(onRename).toHaveBeenCalledWith("Misty system design");
    expect(container.querySelector("h2")?.textContent).toBe("Misty system design");
  });
});

function drawingFixture(): SpaceDrawing {
  return {
    id: "drawing-1",
    space_id: "space-1",
    creator_user_id: "user-1",
    title: "Home Drawing",
    lifecycle_state: "active",
    collaboration_revision: 1,
    acl_version: 1,
    created_at: "2026-08-28T12:00:00.000Z",
    updated_at: "2026-08-28T12:00:00.000Z",
    role: "creator",
    can_delete: true,
  };
}
