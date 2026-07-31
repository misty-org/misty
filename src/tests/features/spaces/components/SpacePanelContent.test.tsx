import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Space } from "@/models/interfaces/features/spaces/types";
import { useSpacesStore } from "@/stores/spaces/useSpacesStore";
import { SpacePanelContent } from "@/features/spaces/components/SpacePanelContent";

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
              element={
                <SpacePanelContent spaces={[]} limits={null} loading={true} onAddSpace={() => {}} />
              }
            />
          </Routes>
        </MemoryRouter>,
      );
    });

    // While loading spaces = [], skeleton is visible instead of section navigation
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    expect(container.querySelector("nav[aria-label='Space sections']")).toBeNull();

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/spaces/space-1/library"]}>
          <Routes>
            <Route
              path="/spaces/:spaceId/:section"
              element={
                <SpacePanelContent
                  spaces={[space1]}
                  limits={null}
                  loading={false}
                  onAddSpace={() => {}}
                />
              }
            />
          </Routes>
        </MemoryRouter>,
      );
    });

    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    // Once spin timer finishes, the mode-specific sidebar replaces the skeleton.
    // Primary mode navigation lives in the shell header.
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.querySelector("nav[aria-label='Space sections']")).toBeNull();
    expect(container.querySelector("nav[aria-label='Library collections']")).not.toBeNull();
    vi.useRealTimers();
  });
});
