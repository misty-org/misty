import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ComingSoonSurface, mistyRoadmapUrl } from "./coming-soon-surface";

describe("ComingSoonSurface", () => {
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

  it("uses the same concise message for every unavailable feature", async () => {
    await act(async () => root.render(<ComingSoonSurface feature="Roadmaps" />));

    expect(container.querySelector("h1")?.textContent).toBe("coming soon...");
    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe(mistyRoadmapUrl);
    expect(link?.getAttribute("target")).toBe("_blank");
  });
});
