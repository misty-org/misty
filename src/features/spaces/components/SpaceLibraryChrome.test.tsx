import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SpaceLibraryHeader } from "./SpaceLibraryChrome";

describe("SpaceLibraryHeader", () => {
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

  it("offers only the large grid and list layouts", async () => {
    await act(async () => {
      root.render(
        <SpaceLibraryHeader
          uploadAvailable
          uploading={false}
          uploadDisabled={false}
          onUpload={vi.fn()}
          searchInput=""
          onSearchInput={vi.fn()}
          onSearchFocus={vi.fn()}
          onSearchBlur={vi.fn()}
          mediaType=""
          onMediaType={vi.fn()}
          sort="recently-added"
          direction="desc"
          onSort={vi.fn()}
          albumOrderAvailable={false}
          viewMode="grid"
          onViewMode={vi.fn()}
          visibleItemCount={6}
        />,
      );
    });

    const layout = container.querySelector('[aria-label="Library layout"]');
    expect(layout?.querySelectorAll("button")).toHaveLength(2);
    expect(layout?.querySelector('button[aria-label="Grid view"]')).not.toBeNull();
    expect(layout?.querySelector('button[aria-label="List view"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Thumbnail density"]')).toBeNull();
    expect(container.querySelector('[aria-label="Library collections"]')).toBeNull();
    expect(container.querySelector('input[aria-label="Search Library"]')).not.toBeNull();
    expect(
      [...container.querySelectorAll("button")].some((button) => button.textContent === "Select"),
    ).toBe(false);
  });
});
