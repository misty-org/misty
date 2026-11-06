import { type EdgeProps, getBezierPath } from "@xyflow/react";
import { useEffect, useRef } from "react";
import { drawnEdges } from "./drawnEdges";

/** A thin curve that draws itself out of the parent when it appears. */
export function MemoryEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
}: EdgeProps) {
  // Decided once per mounted curve, so moving a node or a re-render never replays the draw.
  const draws = useRef(!drawnEdges.has(id));
  useEffect(() => {
    drawnEdges.add(id);
  }, [id]);
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    curvature: 0.35,
  });
  return (
    <path
      d={path}
      pathLength={1}
      fill="none"
      className={draws.current ? "memory-edge memory-edge-draw" : "memory-edge"}
    />
  );
}
