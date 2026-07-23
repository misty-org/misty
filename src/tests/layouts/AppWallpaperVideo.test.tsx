import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppWallpaperVideo } from "@/layouts/AppWallpaperVideo";

describe("AppWallpaperVideo", () => {
  let container: HTMLDivElement;
  let paused: boolean;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    paused = true;
    vi.spyOn(HTMLMediaElement.prototype, "paused", "get").mockImplementation(() => paused);
    vi.spyOn(HTMLMediaElement.prototype, "currentTime", "get").mockImplementation(() =>
      paused ? 0 : Date.now() / 1_000,
    );
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {
      paused = true;
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  function startPlaying(this: HTMLMediaElement): Promise<void> {
    paused = false;
    this.dispatchEvent(new Event("playing"));
    return Promise.resolve();
  }

  it("keeps decorative native controls disabled", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(startPlaying);

    await act(async () => {
      root.render(<AppWallpaperVideo src="asset://wallpaper.mp4" />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
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
      .mockImplementation(startPlaying);

    await act(async () => {
      root.render(<AppWallpaperVideo src="asset://wallpaper.mp4" />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(play).toHaveBeenCalledTimes(2);

    await act(async () => {
      paused = true;
      container.querySelector("video")?.dispatchEvent(new Event("pause"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(play).toHaveBeenCalledTimes(3);
  });

  it("keeps retrying when WebKit resolves play while the video is still paused", async () => {
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockResolvedValueOnce(undefined)
      .mockImplementation(startPlaying);

    await act(async () => {
      root.render(<AppWallpaperVideo src="asset://wallpaper.mp4" />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(play).toHaveBeenCalledTimes(2);
  });

  it("does not trust a non-paused state until playback is observable", async () => {
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockImplementationOnce(() => {
        paused = false;
        return Promise.resolve();
      })
      .mockImplementation(startPlaying);

    await act(async () => {
      root.render(<AppWallpaperVideo src="asset://wallpaper.mp4" />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(play).toHaveBeenCalledTimes(2);
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

    play.mockImplementation(startPlaying);
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
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(startPlaying);

    await act(async () => {
      root.render(<AppWallpaperVideo src="asset://wallpaper-with-audio.mp4" />);
    });
    const video = container.querySelector("video");
    expect(video?.className).not.toContain("opacity-0");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(play).toHaveBeenCalledTimes(1);
    await act(async () => {
      paused = true;
      video?.dispatchEvent(new Event("pause"));
    });
    expect(video?.className).not.toContain("opacity-0");
  });

  it("starts playback even when the app launches inactive", async () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(startPlaying);

    await act(async () => {
      root.render(<AppWallpaperVideo src="asset://wallpaper.mp4" />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(play).toHaveBeenCalledTimes(1);
  });
});
