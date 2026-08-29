import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpaceDrawing } from "./types";

const { drawing } = vi.hoisted(() => ({
  drawing: {
    id: "drawing-1",
    space_id: "space-product",
    creator_user_id: "account-1",
    title: "System design",
    lifecycle_state: "active",
    collaboration_revision: 1,
    acl_version: 1,
    created_at: "2026-08-29T12:00:00.000Z",
    updated_at: "2026-08-29T12:00:00.000Z",
    role: "creator",
    can_delete: true,
  } satisfies SpaceDrawing,
}));

vi.mock("@/features/auth", () => ({
  useAuth: () => ({
    user: { id: "account-1", name: "Alex", email: "alex@example.com" },
  }),
}));

vi.mock("./hooks/useSpaceDrawings", () => ({
  useSpaceDrawings: () => ({
    drawings: [drawing],
    loading: false,
    error: null,
    reload: vi.fn(),
    create: vi.fn(),
    rename: vi.fn().mockResolvedValue(drawing),
    remove: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("./hooks/useDrawingRoom", () => ({
  useDrawingRoom: () => ({ session: null, synced: false, notice: null, error: null }),
}));

vi.mock("./components/DrawingPreview", () => ({
  DrawingPreview: () => <div data-testid="drawing-preview" />,
}));

import { SpaceDrawings } from "./SpaceDrawings";

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location-probe">{`${location.pathname}${location.search}`}</output>;
}

function drawingSurface(entry: string) {
  return (
    <MemoryRouter key={entry} initialEntries={[entry]}>
      <SpaceDrawings
        spaceId="space-product"
        drawingId={entry.includes("drawing-1") ? "drawing-1" : ""}
      />
      <LocationProbe />
    </MemoryRouter>
  );
}

describe("SpaceDrawings route-backed page state", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("keeps the listing page after a tab remount even when a drawing remains selected", async () => {
    const listRoute = "/spaces/space-product/drawings/drawing-1?view=list";
    await act(async () => root.render(drawingSurface(listRoute)));

    expect(container.textContent).toContain("My Drawings");
    expect(container.querySelector('button[aria-label="Back to drawings"]')).toBeNull();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Open System design"]')
        ?.click();
    });
    expect(container.querySelector('[data-testid="location-probe"]')?.textContent).toBe(
      "/spaces/space-product/drawings/drawing-1?view=canvas",
    );
    expect(container.querySelector('button[aria-label="Back to drawings"]')).not.toBeNull();

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Back to drawings"]')?.click();
    });
    expect(container.querySelector('[data-testid="location-probe"]')?.textContent).toBe(listRoute);

    await act(async () => root.render(drawingSurface(listRoute)));
    expect(container.textContent).toContain("My Drawings");
    expect(container.querySelector('button[aria-label="Back to drawings"]')).toBeNull();
  });
});
