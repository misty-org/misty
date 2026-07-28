import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppWallpaperVideo } from "@/layouts/AppWallpaperVideo";

describe("AppWallpaperVideo", () => {
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

  it("uses WebKit's native muted inline autoplay policy", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play");
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause");
    const load = vi.spyOn(HTMLMediaElement.prototype, "load");

    await act(async () => {
      root.render(<AppWallpaperVideo src="asset://wallpaper.mp4" />);
    });

    const video = container.querySelector("video");
    expect(video?.autoplay).toBe(true);
    expect(video?.muted).toBe(true);
    expect(video?.playsInline).toBe(true);
    expect(video?.loop).toBe(true);
    expect(video?.controls).toBe(false);
    expect(video?.preload).toBe("auto");
    expect(video?.getAttribute("aria-hidden")).toBe("true");
    expect(video?.getAttribute("controlsList")).toContain("noremoteplayback");

    expect(play).toHaveBeenCalled();
    expect(pause).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });

  it("lets WebKit reload a changed source by replacing the media element", async () => {
    await act(async () => {
      root.render(<AppWallpaperVideo src="asset://first.mp4" />);
    });
    const firstVideo = container.querySelector("video");

    await act(async () => {
      root.render(<AppWallpaperVideo src="asset://second.mp4" />);
    });
    const secondVideo = container.querySelector("video");

    expect(secondVideo).not.toBe(firstVideo);
    expect(secondVideo?.getAttribute("src")).toBe("asset://second.mp4");
  });
});
