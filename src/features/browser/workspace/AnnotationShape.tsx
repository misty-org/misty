// The marks a person draws over a page in annotation mode, and how each one is drawn.

export type AnnotationTool = "pen" | "line" | "rectangle" | "ellipse" | "text" | "eraser";
export type Point = { x: number; y: number };
export type DrawingMark = {
  id: string;
  tool: Exclude<AnnotationTool, "eraser" | "text">;
  color: string;
  points: Point[];
};
type TextMark = { id: string; tool: "text"; color: string; point: Point; text: string };
export type AnnotationMark = DrawingMark | TextMark;

export function AnnotationShape({ mark }: { mark: AnnotationMark }) {
  if (mark.tool === "text") {
    return (
      <text x={mark.point.x} y={mark.point.y} fill={mark.color} fontSize="20" fontWeight="600">
        {mark.text}
      </text>
    );
  }
  const first = mark.points[0];
  const last = mark.points[mark.points.length - 1] ?? first;
  const shared = {
    fill: "none",
    stroke: mark.color,
    strokeWidth: 4,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (mark.tool === "pen") {
    return <path d={pathData(mark.points)} {...shared} />;
  }
  if (mark.tool === "line") {
    return <line x1={first.x} y1={first.y} x2={last.x} y2={last.y} {...shared} />;
  }
  const x = Math.min(first.x, last.x);
  const y = Math.min(first.y, last.y);
  const width = Math.abs(last.x - first.x);
  const height = Math.abs(last.y - first.y);
  if (mark.tool === "rectangle")
    return <rect x={x} y={y} width={width} height={height} {...shared} />;
  return (
    <ellipse cx={x + width / 2} cy={y + height / 2} rx={width / 2} ry={height / 2} {...shared} />
  );
}

export function pathData(points: Point[]): string {
  if (!points.length) return "";
  return points.map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" ");
}

export function markNearPoint(mark: AnnotationMark, point: Point): boolean {
  if (mark.tool === "text") {
    return Math.hypot(mark.point.x - point.x, mark.point.y - point.y) < 36;
  }
  return mark.points.some(
    (candidate) => Math.hypot(candidate.x - point.x, candidate.y - point.y) < 18,
  );
}
