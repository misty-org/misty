import type { Space } from "@/api/spaces/dto/interfaces/types";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpacePanelContent } from "../components/SpacePanelContent";
import { spacePanelSidebarAvailable } from "../components/spacePanel/SpacePanelSidebarContext";
import { useSpacesStore } from "../store/useSpacesStore";

describe("SpacePanelContent", () => {
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
    useSpacesStore.setState({ spaces: [] });
    container.remove();
  });

  it("reserves the contextual sidebar for Social, not Journal", () => {
    expect(spacePanelSidebarAvailable("social")).toBe(true);
    expect(spacePanelSidebarAvailable("notes")).toBe(false);
    expect(spacePanelSidebarAvailable("drawings")).toBe(false);
  });

  it("does not repeat the selected Space in a sidebar header", async () => {
    const space = spaceFixture();

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/spaces/space-1/library"]}>
          <Routes>
            <Route
              path="/spaces/:spaceId/:section"
              element={<SpacePanelContent spaces={[space]} loading={false} />}
            />
          </Routes>
        </MemoryRouter>,
      );
    });

    expect(container.textContent).not.toContain("Design team");
    expect(
      container.querySelector('[aria-label="Design team default profile picture"]'),
    ).toBeNull();
    expect(container.querySelector("header")).toBeNull();
    expect(container.querySelector('[aria-label^="Space menu"]')).toBeNull();
    expect(container.querySelector("nav[aria-label='Space sections']")).toBeNull();
    expect(container.querySelector("nav[aria-label='Space management']")).toBeNull();
    expect(container.querySelector("nav[aria-label='Library collections']")).toBeNull();
  });

  it("does not render skeleton and active space navigation stacked together", async () => {
    vi.useFakeTimers();
    const space1: Space = {
      id: "space-1",
      is_default: true,
      owner_user_id: "owner",
      name: "Space One",
      role: "owner",
      member_count: 1,
      pending_count: 0,
      is_shared: true,
      created_at: "2026-07-19T00:00:00Z",
      updated_at: "2026-07-19T00:00:00Z",
    };

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/spaces/space-1/library"]}>
          <Routes>
            <Route
              path="/spaces/:spaceId/:section"
              element={<SpacePanelContent spaces={[]} loading={true} />}
            />
          </Routes>
        </MemoryRouter>,
      );
    });

    // While loading spaces = [], the rail shows its loading state.
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    expect(container.querySelector("nav[aria-label='Space sections']")).toBeNull();

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/spaces/space-1/library"]}>
          <Routes>
            <Route
              path="/spaces/:spaceId/:section"
              element={<SpacePanelContent spaces={[space1]} loading={false} />}
            />
          </Routes>
        </MemoryRouter>,
      );
    });

    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    // Once spin timer finishes, a destination-only Library panel stays empty;
    // its stable collection hierarchy lives in the global navigator.
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.querySelector("nav[aria-label='Space sections']")).toBeNull();
    expect(container.querySelector("nav[aria-label='Library collections']")).toBeNull();
    vi.useRealTimers();
  });
});

function spaceFixture(patch: Partial<Space> = {}): Space {
  return {
    id: "space-1",
    is_default: false,
    owner_user_id: "owner",
    name: "Design team",
    role: "owner",
    member_count: 2,
    pending_count: 0,
    is_shared: true,
    created_at: "2026-07-19T00:00:00Z",
    updated_at: "2026-07-19T00:00:00Z",
    ...patch,
  };
}
