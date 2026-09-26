import { useState, type CSSProperties } from "react";
export type BrowserViewport = "responsive" | "desktop";
export type BrowserViewportDevice = Exclude<BrowserViewport, "responsive">;
export type BrowserViewportSize = {
  width: number;
  height: number;
};
export type BrowserViewportAxis = keyof BrowserViewportSize;
export const browserViewportDefaults: Record<BrowserViewportDevice, BrowserViewportSize> = {
  desktop: {
    width: 1920,
    height: 1080,
  },
};
export const browserViewportRanges: Record<
  BrowserViewportDevice,
  Record<
    BrowserViewportAxis,
    {
      min: number;
      max: number;
    }
  >
> = {
  desktop: {
    width: {
      min: 1024,
      max: 2560,
    },
    height: {
      min: 600,
      max: 1600,
    },
  },
};
export const browserViewportStep = 2;
export function useBrowserViewport() {
  const [viewport, setViewport] = useState<BrowserViewport>("responsive");
  const [sizes, setSizes] = useState(browserViewportDefaults);
  const setSize = (device: BrowserViewportDevice, size: BrowserViewportSize) =>
    setSizes((current) => ({
      ...current,
      [device]: size,
    }));
  const size = viewport === "responsive" ? null : sizes[viewport];
  return {
    viewport,
    setViewport,
    sizes,
    setSize,
    size,
  };
}

// Stages declare `container-type: size`, so the frame keeps the chosen
// aspect ratio while shrinking to fit a pane smaller than the target size.
export const browserViewportStageStyle: CSSProperties = {
  containerType: "size",
};
export function browserViewportFrameStyle(size: BrowserViewportSize | null): CSSProperties {
  if (!size)
    return {
      width: "100%",
      height: "100%",
    };
  const { width, height } = size;
  return {
    width: `min(100cqw, ${width}px, calc(100cqh * ${width} / ${height}))`,
    height: `min(100cqh, ${height}px, calc(100cqw * ${height} / ${width}))`,
  };
}
