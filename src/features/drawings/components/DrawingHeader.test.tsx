import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpaceDrawing } from "../types";
import { DrawingHeader } from "./DrawingHeader";

vi.mock("@/features/activity", () => ({
  reportSystemError: vi.fn(),
}));

describe("DrawingHeader", () => {
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

  it("shows the bordered title field and reveals a disabled Save button only while active", async () => {
    await renderHeader();

    const input = container.querySelector<HTMLInputElement>('input[aria-label="Drawing title"]');
    expect(input).not.toBeNull();
    expect(input?.value).toBe("Home Drawing");
    expect(input?.className).toContain("border-charcoal-active");
    expect(container.querySelector('button[aria-label="Save drawing title"]')).toBeNull();
    await act(async () => input?.focus());
    expect(
      container.querySelector<HTMLButtonElement>('button[aria-label="Save drawing title"]')
        ?.disabled,
    ).toBe(true);
    expect(container.textContent).not.toContain("Cancel");
    expect(container.textContent).not.toContain("Search");
    expect(container.textContent).not.toContain("New");
    expect(container.textContent).not.toContain("Live");
    expect(container.querySelector('button[aria-label="Delete drawing"]')).toBeNull();
  });

  it("enables Save after a local change and saves on Enter", async () => {
    const onRename = vi.fn(async () => undefined);
    await renderHeader(onRename);

    const input = container.querySelector<HTMLInputElement>('input[aria-label="Drawing title"]');
    await act(async () => input?.focus());
    await act(async () => {
      if (!input) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        input,
        "Project map",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(
      container.querySelector<HTMLButtonElement>('button[aria-label="Save drawing title"]')
        ?.disabled,
    ).toBe(false);

    await act(async () => {
      if (!input) return;
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });

    expect(onRename).toHaveBeenCalledWith("Project map");
    expect(input?.value).toBe("Project map");
    expect(
      container.querySelector<HTMLButtonElement>('button[aria-label="Save drawing title"]')
        ?.disabled,
    ).toBe(true);

    await act(async () => input?.blur());
    expect(container.querySelector('button[aria-label="Save drawing title"]')).toBeNull();
  });

  async function renderHeader(onRename = vi.fn(async () => undefined)) {
    await act(async () => {
      root.render(
        <DrawingHeader drawing={drawingFixture()} onBack={vi.fn()} onRename={onRename} />,
      );
    });
  }
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
    can_delete: false,
  };
}
