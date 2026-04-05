import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../spaces/api", () => ({
  spacesApi: {
    libraryItems: vi.fn().mockResolvedValue({ items: [] }),
  },
}));

import { MistyLibraryPicker } from "./MistyLibraryPicker";

describe("MistyLibraryPicker", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("keeps the search icon and input in one scoped control", async () => {
    await act(async () => {
      root.render(<MistyLibraryPicker spaceId="space-1" selectedIds={[]} onCancel={vi.fn()} onChoose={vi.fn()} />);
      await Promise.resolve();
    });

    const search = document.body.querySelector('[role="search"].misty-library-picker-search');
    expect(search?.querySelector("svg")).not.toBeNull();
    expect(search?.querySelector('input[aria-label="Search Library"]')).not.toBeNull();
    expect(search?.closest("label")).toBeNull();
  });
});
