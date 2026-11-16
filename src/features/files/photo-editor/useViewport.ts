import { useCallback, useEffect, useMemo, useState } from "react";

/** Room kept around the image when it fits, so the crop's handles never touch the stage's edge. */
const margin = 32;
/** The zoom steps the buttons and keys move through, as display pixels per image pixel. */
const zoomSteps = [0.05, 0.1, 0.125, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12, 16];
const minScale = 0.02;
const maxScale = 16;

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

type View = { fit: true } | { fit: false; scale: number; x: number; y: number };

/**
 * Zoom and pan over the image. It fits the stage until the person zooms, then holds its zoom
 * and keeps the image from being pushed out of sight. `content` is the image's size in its own
 * pixels; positions are in the stage's pixels.
 */
export function useViewport(content: { width: number; height: number }) {
  const [stage, setStage] = useState<HTMLElement | null>(null);
  const [room, setRoom] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!stage) return;
    const measure = () => {
      const width = stage.clientWidth;
      const height = stage.clientHeight;
      setRoom((current) =>
        current.width === width && current.height === height ? current : { width, height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [stage]);

  const [view, setView] = useState<View>({ fit: true });
  const contentWidth = Math.max(1, content.width);
  const contentHeight = Math.max(1, content.height);
  const fitScale =
    room.width > 0 && room.height > 0
      ? Math.max(
          minScale,
          Math.min(
            1,
            (room.width - margin * 2) / contentWidth,
            (room.height - margin * 2) / contentHeight,
          ),
        )
      : 1;
  const scale = view.fit ? fitScale : view.scale;
  const width = contentWidth * scale;
  const height = contentHeight * scale;

  // Off-center as far as the image overhangs the stage, and no further.
  const pan = useCallback(
    (offset: number, size: number, roomSize: number) =>
      size <= roomSize - margin * 2
        ? 0
        : clamp(offset, -(size - roomSize) / 2 - margin, (size - roomSize) / 2 + margin),
    [],
  );
  const x = view.fit ? 0 : pan(view.x, width, room.width);
  const y = view.fit ? 0 : pan(view.y, height, room.height);
  const left = (room.width - width) / 2 + x;
  const top = (room.height - height) / 2 + y;

  const zoomTo = useCallback(
    (next: number, anchor?: { x: number; y: number }) => {
      const target = clamp(next, minScale, maxScale);
      const at = anchor ?? { x: room.width / 2, y: room.height / 2 };
      // The image point under the anchor stays under it.
      const imageX = (at.x - left) / scale;
      const imageY = (at.y - top) / scale;
      const nextLeft = at.x - imageX * target;
      const nextTop = at.y - imageY * target;
      setView({
        fit: false,
        scale: target,
        x: pan(
          nextLeft - (room.width - contentWidth * target) / 2,
          contentWidth * target,
          room.width,
        ),
        y: pan(
          nextTop - (room.height - contentHeight * target) / 2,
          contentHeight * target,
          room.height,
        ),
      });
    },
    [contentHeight, contentWidth, left, pan, room.height, room.width, scale, top],
  );
  const zoomBy = useCallback(
    (factor: number, anchor?: { x: number; y: number }) => zoomTo(scale * factor, anchor),
    [scale, zoomTo],
  );
  const zoomIn = useCallback(() => {
    const next = zoomSteps.find((step) => step > scale * 1.01) ?? maxScale;
    zoomTo(next);
  }, [scale, zoomTo]);
  const zoomOut = useCallback(() => {
    const next = [...zoomSteps].reverse().find((step) => step < scale * 0.99) ?? minScale;
    zoomTo(next);
  }, [scale, zoomTo]);
  const fit = useCallback(() => setView({ fit: true }), []);
  const panBy = useCallback(
    (dx: number, dy: number) =>
      setView((current) => {
        const base = current.fit ? { scale: fitScale, x: 0, y: 0 } : current;
        const size = { width: contentWidth * base.scale, height: contentHeight * base.scale };
        return {
          fit: false,
          scale: base.scale,
          x: pan(pan(base.x, size.width, room.width) + dx, size.width, room.width),
          y: pan(pan(base.y, size.height, room.height) + dy, size.height, room.height),
        };
      }),
    [contentHeight, contentWidth, fitScale, pan, room.height, room.width],
  );

  return useMemo(
    () => ({
      setStage,
      room,
      fitted: view.fit,
      scale,
      left,
      top,
      width,
      height,
      /** Whether the image is bigger than the stage, so dragging it moves it. */
      pannable: width > room.width - margin * 2 || height > room.height - margin * 2,
      zoomTo,
      zoomBy,
      zoomIn,
      zoomOut,
      fit,
      panBy,
      canZoomIn: scale < maxScale - 1e-6,
      canZoomOut: scale > minScale + 1e-6,
    }),
    [fit, height, left, panBy, room, scale, top, view.fit, width, zoomBy, zoomIn, zoomOut, zoomTo],
  );
}

export type Viewport = ReturnType<typeof useViewport>;
