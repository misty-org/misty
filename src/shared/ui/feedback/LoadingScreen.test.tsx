import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LoadingScreen } from "@/shared/ui";

describe("LoadingScreen", () => {
  let container: HTMLDivElement;
  let root: Root;
  const screen = () => container.firstElementChild as HTMLElement;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("fades out the moment it is leaving", () => {
    act(() => root.render(<LoadingScreen fullScreen />));
    act(() => root.render(<LoadingScreen fullScreen leaving />));
    expect(screen().className).toContain("misty-loading-screen-leaving");
  });

  it("doesn't fade while it is still loading", () => {
    act(() => root.render(<LoadingScreen fullScreen />));
    expect(screen().className).not.toContain("misty-loading-screen-leaving");
  });
});
