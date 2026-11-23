import { refinePointOnEngine } from "../../engines/misty_calls";
import { invoke } from "@tauri-apps/api/core";
import type { PointFrame, PresentedPoint } from "./protocol";

type ModelPoint = Pick<PresentedPoint, "x" | "y" | "displayId" | "label">;
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
  region: PointFrame;
}

const SNAP_TIMEOUT_MS = 700;
const REFINE_REGION = 280;
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

const maxRefinements = 4;
const refineWindowMs = 10 * 60_000;
const refinements = new Map<string, { calls: number; first: number }>();

function spendRefinement(invocationId: string, now = Date.now()): boolean {
  for (const [id, entry] of refinements)
    if (now - entry.first > refineWindowMs) refinements.delete(id);
  const entry = refinements.get(invocationId) ?? { calls: 0, first: now };
  if (entry.calls >= maxRefinements) return false;
  refinements.set(invocationId, { ...entry, calls: entry.calls + 1 });
  return true;
}

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
  if (!spendRefinement(invocationId)) return undefined;
  if (crop.mimeType !== "image/jpeg" && crop.mimeType !== "image/png") return undefined;
  const result = await refinePointOnEngine({
    image: {
      mimeType: crop.mimeType,
      dataUrl: crop.dataUrl,
      width: crop.width,
      height: crop.height,
    },
    label: point.label,
    hint: {
      x: Math.round((point.x - crop.region.x) * scaleX),
      y: Math.round((point.y - crop.region.y) * scaleY),
    },
  });
  if (!result.found || !finite(result.x, result.y)) return undefined;
  return {
    ...point,
    x: crop.region.x + result.x / scaleX,
    y: crop.region.y + result.y / scaleY,
  };
}
