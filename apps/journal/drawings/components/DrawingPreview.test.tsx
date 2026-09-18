import type { AuthUser } from "@/features/auth";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpaceDrawing } from "../types";
import { DrawingPreview } from "./DrawingPreview";

vi.mock("../hooks/useDrawingRoom", () => ({
  useDrawingRoom: () => ({
    session: null,
    synced: false,
    error: null,
  }),
}));

describe("DrawingPreview", () => {
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

  it("keeps export, copy, and background controls compact", async () => {
    await act(async () => {
      root.render(<DrawingPreview drawing={drawingFixture()} user={userFixture()} />);
    });

    const toolbar = container.querySelector('[role="toolbar"]');
    expect(toolbar?.textContent).toContain("Export image");
    expect(toolbar?.textContent).toContain("Copy to clipboard");
    expect(toolbar?.textContent).not.toContain("Canvas background");
    expect(toolbar?.textContent).not.toContain("Save to…");
    expect(toolbar?.textContent).not.toContain("Find");
    expect(toolbar?.textContent).not.toContain("Help");
    expect(container.textContent).toContain("Preparing preview…");
    const exportButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Export image"),
    );
    const copyButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Copy to clipboard"),
    );
    expect(exportButton?.disabled).toBe(true);
    expect(copyButton?.disabled).toBe(true);
    expect(copyButton?.querySelector("svg")).not.toBeNull();
    expect(container.querySelector('input[type="text"], textarea')).toBeNull();
    expect(
      container.querySelector('input[type="color"][aria-label="Custom preview background"]'),
    ).not.toBeNull();

    const backgrounds = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button[aria-label^="Preview background"]'),
    );
    expect(backgrounds).toHaveLength(6);
    expect(backgrounds[0]?.getAttribute("aria-pressed")).toBe("true");
    await act(async () => {
      backgrounds[1]?.click();
    });
    expect(backgrounds[1]?.getAttribute("aria-pressed")).toBe("true");
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

function userFixture(): AuthUser {
  return {
    id: "user-1",
    name: "Matthew Chen",
    email: "mattdev727@gmail.com",
  };
}
