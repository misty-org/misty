import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DesktopAccessState, mistyDownloadUrl } from "./desktop-access-state";

describe("DesktopAccessState", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("explains the browser boundary and links to the desktop download", () => {
    act(() => root.render(<DesktopAccessState feature="Files" />));

    expect(container.textContent).toContain("Files requires the Misty desktop app");
    expect(container.textContent).toContain("Download for full access");
    expect(container.querySelector<HTMLAnchorElement>("a")?.href).toBe(mistyDownloadUrl);
  });
});
