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
    vi.useFakeTimers();
    vi.spyOn(HTMLMediaElement.prototype, "paused", "get").mockReturnValue(true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it("keeps decorative native controls disabled", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);

    await act(async () => {
      root.render(<AppWallpaperVideo src="asset://wallpaper.mp4" />);
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const video = container.querySelector("video");
    expect(video?.controls).toBe(false);
    expect(video?.autoplay).toBe(true);
    expect(video?.muted).toBe(true);
    expect(video?.getAttribute("aria-hidden")).toBe("true");
    expect(video?.getAttribute("controlsList")).toContain("noremoteplayback");
    expect(video?.volume).toBe(0);
  });

  it("retries a rejected autoplay attempt and resumes after an unexpected pause", async () => {
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockRejectedValueOnce(new DOMException("Not ready", "NotAllowedError"))
      .mockResolvedValue(undefined);

    await act(async () => {
      root.render(<AppWallpaperVideo src="asset://wallpaper.mp4" />);
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(play).toHaveBeenCalledTimes(2);

    await act(async () => {
      container.querySelector("video")?.dispatchEvent(new Event("pause"));
      await vi.runAllTimersAsync();
    });
    expect(play).toHaveBeenCalledTimes(3);
  });

  it("keeps retrying while WebKit restores playback after a reload", async () => {
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockRejectedValue(new DOMException("Media session suspended", "NotAllowedError"));

    await act(async () => {
      root.render(<AppWallpaperVideo src="asset://wallpaper.mp4" />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_700);
    });

    expect(play).toHaveBeenCalledTimes(6);

    play.mockResolvedValue(undefined);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(play).toHaveBeenCalledTimes(7);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(play).toHaveBeenCalledTimes(7);
  });

  it("keeps the wallpaper visible and resumes after a pause", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);

    await act(async () => {
      root.render(<AppWallpaperVideo src="asset://wallpaper-with-audio.mp4" />);
    });
    const video = container.querySelector("video");
    expect(video?.className).not.toContain("opacity-0");

    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(play).toHaveBeenCalledTimes(1);
    await act(async () => video?.dispatchEvent(new Event("pause")));
    expect(video?.className).not.toContain("opacity-0");
  });

  it("starts playback even when the app launches inactive", async () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);

    await act(async () => {
      root.render(<AppWallpaperVideo src="asset://wallpaper.mp4" />);
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(play).toHaveBeenCalledTimes(1);
  });
});
