import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JournalAttribution } from "@/features/journal/components/JournalAttribution";
import { NotesPanelSidebar } from "@/features/notes/components/NotesPanelSidebar";
import { DrawingPanelSidebar } from "@/features/drawings/components/DrawingPanelSidebar";

vi.mock("@/features/drawings/hooks/useSpaceDrawings", () => ({
  useSpaceDrawings: () => ({ drawings: [], loading: false, create: vi.fn() }),
}));

describe("Journal branding", () => {
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

  it("renders Notes and Drawings as separate sidebar dropdowns", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <NotesPanelSidebar
            spaceId="space-1"
            spaceName="Design team"
            section={{ active: false, to: "/spaces/space-1/notes" }}
          />
          <DrawingPanelSidebar
            spaceId="space-1"
            activeDrawingId=""
            section={{ active: true, to: "/spaces/space-1/drawings" }}
          />
        </MemoryRouter>,
      );
    });

    expect(container.querySelector('a[href="/spaces/space-1/notes"]')?.textContent).toContain(
      "Notes",
    );
    expect(
      container.querySelector('a[href="/spaces/space-1/drawings"][aria-current="page"]')
        ?.textContent,
    ).toContain("Drawings");
    expect(container.querySelector('[aria-label="Expand Notes"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Collapse Drawings"]')).not.toBeNull();
  });

  it("credits the editor technology alongside Misty Journal", async () => {
    await act(async () => {
      root.render(<JournalAttribution technology="Excalidraw" href="https://excalidraw.com/" />);
    });

    const credit = container.querySelector("a");
    expect(credit?.textContent).not.toContain("Misty Journal");
    expect(credit?.textContent).toContain("powered by Excalidraw");
    expect(credit?.getAttribute("href")).toBe("https://excalidraw.com/");
  });
});
