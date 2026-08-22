import type { Space } from "@/api/spaces/dto/interfaces/types";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpacePanelContent } from "../components/SpacePanelContent";
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
    expect(container.querySelector("nav[aria-label='Library collections']")).not.toBeNull();
  });

  it("shows only Chat in the canonical Misty Space", async () => {
    const space = spaceFixture({
      id: "misty",
      kind: "misty",
      name: "Misty",
      role: "member",
      permissions: { "messages.read": true, "space.invite": false },
    });

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/spaces/misty/chat"]}>
          <Routes>
            <Route
              path="/spaces/:spaceId/:section"
              element={<SpacePanelContent spaces={[space]} loading={false} />}
            />
          </Routes>
        </MemoryRouter>,
      );
    });

    expect(container.querySelector('[aria-label="Space conversations"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Journal");
    expect(container.textContent).not.toContain("Planner");
    expect(container.textContent).not.toContain("Library");
    expect(container.querySelector("nav[aria-label='Space management']")).toBeNull();
  });

  it("does not expose the shared Everyone conversation", async () => {
    const space = spaceFixture({
      id: "misty",
      kind: "misty",
      name: "Misty",
      role: "member",
      permissions: { "messages.read": true, "space.invite": false },
    });

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/spaces/misty/chat"]}>
          <Routes>
            <Route
              path="/spaces/:spaceId/:section"
              element={<SpacePanelContent spaces={[space]} loading={false} />}
            />
          </Routes>
        </MemoryRouter>,
      );
    });

    expect(container.querySelector('[aria-label="Misty support inbox"]')).toBeNull();
    expect(container.querySelector('[aria-label="Space conversations"]')).not.toBeNull();
    expect(
      container.querySelector('[aria-label="Space conversations"]')?.textContent,
    ).not.toContain("Everyone");
    expect(container.querySelector('[aria-label^="Create a new"]')).toBeNull();
  });

  it("does not render skeleton and active space navigation stacked together", async () => {
    vi.useFakeTimers();
    const space1: Space = {
      id: "space-1",
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

    // Once spin timer finishes, only the selected tool's contextual branch
    // replaces the skeleton in the sidebar. Top-level Space tools live globally.
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.querySelector("nav[aria-label='Space sections']")).toBeNull();
    expect(container.querySelector("nav[aria-label='Library collections']")).not.toBeNull();
    vi.useRealTimers();
  });
});

function spaceFixture(patch: Partial<Space> = {}): Space {
  return {
    id: "space-1",
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
