export interface PointLike {
  x: number;
  y: number;
}

export function physicalToClientPoint(
  point: PointLike,
  scaleFactor: number,
  appZoom: number,
): PointLike {
  const safeScale = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;
  const safeZoom = Number.isFinite(appZoom) && appZoom > 0 ? appZoom : 1;
  return {
    x: point.x / safeScale / safeZoom,
    y: point.y / safeScale / safeZoom,
  };
}

export function dragDistance(a: PointLike, b: PointLike): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function selectDropCandidate<T extends { priority: number; depth: number }>(candidates: T[]): T | null {
  return [...candidates].sort((left, right) => right.priority - left.priority || left.depth - right.depth)[0] ?? null;
}

export function edgeScrollDelta(position: number, start: number, end: number, activationSize: number): number {
  if (position < start + activationSize) return -scrollSpeed(start + activationSize - position);
  if (position > end - activationSize) return scrollSpeed(position - (end - activationSize));
  return 0;
}

function scrollSpeed(distance: number): number {
  return Math.min(18, Math.max(4, distance * 0.55));
}

export function normalizedDragPath(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/g, "");
  return normalized || "/";
}

export function pathContainsPath(parent: string, candidate: string): boolean {
  const normalizedParent = normalizedDragPath(parent);
  const normalizedCandidate = normalizedDragPath(candidate);
  return normalizedCandidate === normalizedParent
    || normalizedCandidate.startsWith(`${normalizedParent}/`)
    || normalizedParent === "/";
}
