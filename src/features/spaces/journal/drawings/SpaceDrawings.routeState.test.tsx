import { act, lazy, Suspense } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpaceDrawing } from "./drawingTypes";

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

vi.mock("@/features/account", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: "account-1", name: "Alex", email: "alex@example.com" } }),
}));

const SpaceDrawings = lazy(() =>
  import("./SpaceDrawings").then((module) => ({ default: module.SpaceDrawings })),
);

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location-probe">{`${location.pathname}${location.search}`}</output>;
}

function drawingSurface(entry: string) {
  return (
    <MemoryRouter key={entry} initialEntries={[entry]}>
      <Suspense fallback={<div>Loading drawing route</div>}>
        <SpaceDrawings
          spaceId="space-product"
          drawingId={entry.includes("drawing-1") ? "drawing-1" : ""}
        />
      </Suspense>
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

  it("opens the whiteboard its address names, and Back leaves for the Whiteboards page", async () => {
    await act(async () => {
      root.render(drawingSurface("/spaces/space-product/drawings/drawing-1"));
      await import("./SpaceDrawings");
    });

    expect(container.textContent).not.toContain("Sign in to open whiteboards");
    const back = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Back to whiteboards"]',
    );
    expect(back).not.toBeNull();
    expect(
      container.querySelector('button[aria-label="Actions for System design"]'),
    ).not.toBeNull();

    await act(async () => back?.click());
    expect(container.querySelector('[data-testid="location-probe"]')?.textContent).toBe(
      "/spaces/space-product/drawings",
    );
  });

  it("draws no list of its own without a whiteboard", async () => {
    await act(async () => {
      root.render(drawingSurface("/spaces/space-product/drawings"));
      await import("./SpaceDrawings");
    });
    expect(container.querySelector('button[aria-label="Back to whiteboards"]')).toBeNull();
    expect(container.querySelector("table")).toBeNull();
  });
});
