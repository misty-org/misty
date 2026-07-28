import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JournalAttribution } from "@/features/journal/components/JournalAttribution";
import { JournalSectionSwitcher } from "@/features/journal/components/JournalSectionSwitcher";

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

  it("groups Notes and Drawings beneath Journal", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <JournalSectionSwitcher spaceId="space-1" section="drawings" />
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain("Journal");
    expect(container.querySelector('a[href="/spaces/space-1/notes"]')?.textContent).toContain(
      "Notes",
    );
    expect(
      container.querySelector('a[href="/spaces/space-1/drawings"][aria-current="page"]')
        ?.textContent,
    ).toContain("Drawings");
  });

  it("credits the editor technology alongside Misty Journal", async () => {
    await act(async () => {
      root.render(<JournalAttribution technology="Excalidraw" href="https://excalidraw.com/" />);
    });

    const credit = container.querySelector("a");
    expect(credit?.textContent).toContain("Misty Journal");
    expect(credit?.textContent).toContain("powered by Excalidraw");
    expect(credit?.getAttribute("href")).toBe("https://excalidraw.com/");
  });
});
