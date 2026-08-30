import type { Monitor } from "@tauri-apps/api/window";

const savedPetPositionKey = "misty.desktop-pet.position.v2";
export const petSize = 164;

export type PetPosition = { x: number; y: number };

export type SurfaceSize = { width: number; height: number };

export type WorkArea = ReturnType<typeof logicalWorkArea>;

export function readSavedPetPosition(): PetPosition | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(savedPetPositionKey) ?? "null") as {
      x?: number;
      y?: number;
    } | null;
    if (!parsed || !Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) return null;
    return { x: parsed.x!, y: parsed.y! };
  } catch {
    return null;
  }
}

export function savePetPosition(position: PetPosition) {
  window.localStorage.setItem(savedPetPositionKey, JSON.stringify(position));
}

export function safePetPosition(
  position: PetPosition | null,
  monitors: Monitor[],
  primary: Monitor | null,
): PetPosition {
  const areas = monitors.map(logicalWorkArea);
  const containingArea = position
    ? areas.find(
        (area) =>
          position.x >= area.left &&
          position.y >= area.top &&
          position.x < area.right &&
          position.y < area.bottom,
      )
    : undefined;
  const area = containingArea ?? (primary ? logicalWorkArea(primary) : areas[0]);
  if (!area) return { x: 20, y: 20 };
  if (!containingArea || !position) {
    return { x: area.right - petSize - 20, y: area.bottom - petSize - 20 };
  }
  return {
    x: clamp(position.x, area.left, area.right - petSize),
    y: clamp(position.y, area.top, area.bottom - petSize),
  };
}

export function logicalWorkArea(monitor: Monitor) {
  const position = monitor.workArea.position.toLogical(monitor.scaleFactor);
  const size = monitor.workArea.size.toLogical(monitor.scaleFactor);
  return {
    left: position.x,
    top: position.y,
    right: position.x + size.width,
    bottom: position.y + size.height,
    width: size.width,
    height: size.height,
  };
}

export function clamp(value: number, minimum: number, maximum: number) {
  if (maximum < minimum) return minimum;
  return Math.max(minimum, Math.min(maximum, value));
}

export function centeredSurfacePosition(
  anchorPosition: PetPosition,
  anchorSize: SurfaceSize,
  surfaceSize: SurfaceSize,
  workArea?: WorkArea,
  margin = 0,
): PetPosition {
  const centered = {
    x: anchorPosition.x + anchorSize.width / 2 - surfaceSize.width / 2,
    y: anchorPosition.y + anchorSize.height / 2 - surfaceSize.height / 2,
  };
  if (!workArea) return centered;
  return {
    x: clamp(centered.x, workArea.left + margin, workArea.right - surfaceSize.width - margin),
    y: clamp(centered.y, workArea.top + margin, workArea.bottom - surfaceSize.height - margin),
  };
}
