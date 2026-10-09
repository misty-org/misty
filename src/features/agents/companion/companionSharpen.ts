import { apiRequest } from "@/api/client";
import { invoke } from "@tauri-apps/api/core";
import type { PointFrame, PresentedPoint } from "./protocol";

/** A point as the model placed it, before Accessibility or a crop sharpen it. */
export type ModelPoint = Pick<PresentedPoint, "x" | "y" | "displayId" | "label">;
export type SharpenedPoint = ModelPoint & { frame?: PointFrame };

interface SnappedElement {
  x: number;
  y: number;
  frame: PointFrame;
}
interface RegionCapture {
  mimeType: "image/jpeg";
  dataUrl: string;
  width: number;
  height: number;
  /** The crop's bounds in global display units. */
  region: PointFrame;
}

/** Accessibility usually answers in tens of milliseconds; never hold a point for long. */
const SNAP_TIMEOUT_MS = 700;
/** The crop around a model's estimate, in display units (points on macOS). */
export const REFINE_REGION = 280;
/** A refined point closer than this to the estimate is the same spot. */
export const REFINE_MIN_MOVE = 6;

const finite = (...values: number[]) => values.every(Number.isFinite);

function withTimeout<T>(operation: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    operation,
    new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** The real control at or near a model's point, centered on it, or undefined. */
export async function snapPoint(point: ModelPoint): Promise<SharpenedPoint | undefined> {
  const element = await withTimeout(
    invoke<SnappedElement | null>("cursor_companion_snap", {
      x: point.x,
      y: point.y,
      label: point.label,
    }),
    SNAP_TIMEOUT_MS,
  ).catch(() => undefined);
  if (
    !element ||
    !finite(element.x, element.y, element.frame.x, element.frame.y) ||
    !finite(element.frame.width, element.frame.height)
  )
    return undefined;
  return { ...point, x: element.x, y: element.y, frame: element.frame };
}

/**
 * Places the point again from a full-resolution crop around the estimate,
 * through the answer's own vision model. Undefined when the model cannot
 * see the control there or the crop is unavailable.
 */
export async function refinePoint(
  point: ModelPoint,
  invocationId: string,
  turn: number,
): Promise<ModelPoint | undefined> {
  if (!point.label.trim()) return undefined;
  const crop = await invoke<RegionCapture>("cursor_companion_capture_region", {
    turn,
    displayId: point.displayId,
    x: point.x,
    y: point.y,
    size: REFINE_REGION,
  });
  if (!crop.region.width || !crop.region.height || !crop.width || !crop.height) return undefined;
  const scaleX = crop.width / crop.region.width,
    scaleY = crop.height / crop.region.height;
  const result = await apiRequest<{ found: boolean; x: number; y: number }>(
    `/me/companion/refine-point/${encodeURIComponent(invocationId)}`,
    {
      method: "POST",
      body: JSON.stringify({
        image: {
          mime_type: crop.mimeType,
          data_url: crop.dataUrl,
          width: crop.width,
          height: crop.height,
        },
        label: point.label,
        hint: {
          x: Math.round((point.x - crop.region.x) * scaleX),
          y: Math.round((point.y - crop.region.y) * scaleY),
        },
      }),
    },
  );
  if (!result.found || !finite(result.x, result.y)) return undefined;
  return {
    ...point,
    x: crop.region.x + result.x / scaleX,
    y: crop.region.y + result.y / scaleY,
  };
}
