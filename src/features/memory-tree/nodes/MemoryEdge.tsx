import { type EdgeProps, getBezierPath } from "@xyflow/react";

/** A thin curve that draws itself out of the parent when it appears. */
export function MemoryEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
}: EdgeProps) {
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    curvature: 0.35,
  });
  return <path d={path} pathLength={1} fill="none" className="memory-edge" />;
}
