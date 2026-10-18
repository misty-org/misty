import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SpaceSectionNavigation } from "../components/SpaceSectionNavigation";

describe("SpaceSectionNavigation", () => {
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

  async function renderAt(section: string) {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[`/spaces/space-1/${section}`]}>
          <SpaceSectionNavigation spaceId="space-1" section={section} />
        </MemoryRouter>,
      );
    });
    return [...container.querySelectorAll("a")];
  }

  it("lists every primitive to every member", async () => {
    const links = await renderAt("library");
    expect(links.map((link) => link.textContent?.trim())).toEqual([
      "Chat",
      "Notes",
      "Drawings",
      "Files",
      "Code",
    ]);
    expect(container.querySelector("nav")?.className).toContain("grid");
    expect(container.querySelector('a[aria-current="page"]')?.textContent).toContain("Files");
    expect(
      links.find((link) => link.textContent?.trim() === "Drawings")?.getAttribute("href"),
    ).toBe("/spaces/space-1/drawings");
  });

  it("keeps Space management out of the section menu", async () => {
    const labels = (await renderAt("social")).map((link) => link.textContent?.trim());
    expect(labels).not.toContain("Members");
    expect(labels).not.toContain("Settings");
  });

  it("marks Drawings on its own", async () => {
    await renderAt("drawings");
    const active = container.querySelector('a[aria-current="page"]');
    expect(active?.textContent).toContain("Drawings");
    expect(active?.getAttribute("href")).toBe("/spaces/space-1/drawings");
  });
});
