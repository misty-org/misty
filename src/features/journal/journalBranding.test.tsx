import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JournalAttribution } from "./components/JournalAttribution";

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
