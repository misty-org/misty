import { cn } from "@/shared/ui";
import { Circle, Eraser, Minus, Pencil, Redo2, Square, Trash2, Type, Undo2, X } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

type AnnotationTool = "pen" | "line" | "rectangle" | "ellipse" | "text" | "eraser";
type Point = { x: number; y: number };
type DrawingMark = {
  id: string;
  tool: Exclude<AnnotationTool, "eraser" | "text">;
  color: string;
  points: Point[];
};
type TextMark = { id: string; tool: "text"; color: string; point: Point; text: string };
type AnnotationMark = DrawingMark | TextMark;

const colors = ["#ef4444", "#3b82f6", "#22c55e", "#f8fafc", "#18181b"];

export function BrowserAnnotationLayer(props: {
  active: boolean;
  onClose: () => void;
  lightChrome: boolean;
}) {
  const [tool, setTool] = useState<AnnotationTool>("pen");
  const [color, setColor] = useState(colors[0]);
  const [marks, setMarks] = useState<AnnotationMark[]>([]);
  const [redo, setRedo] = useState<AnnotationMark[]>([]);
  const [draft, setDraft] = useState<DrawingMark | null>(null);
  const [textDraft, setTextDraft] = useState<{ point: Point; value: string } | null>(null);
  const layerRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    if (!props.active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redoLast();
        else undoLast();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  if (!props.active) return null;

  const pointFromEvent = (event: ReactPointerEvent<SVGSVGElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
      y: Math.max(0, Math.min(rect.height, event.clientY - rect.top)),
    };
  };

  const undoLast = () => {
    setMarks((current) => {
      const last = current[current.length - 1];
      if (!last) return current;
      setRedo((redoMarks) => [...redoMarks, last]);
      return current.slice(0, -1);
    });
  };

  const redoLast = () => {
    setRedo((current) => {
      const last = current[current.length - 1];
      if (!last) return current;
      setMarks((drawing) => [...drawing, last]);
      return current.slice(0, -1);
    });
  };

  const begin = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    const point = pointFromEvent(event);
    if (tool === "text") {
      setTextDraft({ point, value: "" });
      return;
    }
    if (tool === "eraser") {
      eraseAt(point);
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraft({ id: crypto.randomUUID(), tool, color, points: [point] });
  };

  const move = (event: ReactPointerEvent<SVGSVGElement>) => {
    const point = pointFromEvent(event);
    if (tool === "eraser" && event.buttons === 1) {
      eraseAt(point);
      return;
    }
    setDraft((current) => {
      if (!current) return null;
      return current.tool === "pen"
        ? { ...current, points: [...current.points, point] }
        : { ...current, points: [current.points[0], point] };
    });
  };

  const finish = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDraft((current) => {
      if (current && current.points.length > 1) {
        setMarks((existing) => [...existing, current]);
        setRedo([]);
      }
      return null;
    });
  };

  const eraseAt = (point: Point) => {
    setMarks((current) => {
      for (let index = current.length - 1; index >= 0; index -= 1) {
        if (markNearPoint(current[index], point)) {
          setRedo([]);
          return current.filter((_, candidate) => candidate !== index);
        }
      }
      return current;
    });
  };

  const commitText = () => {
    if (textDraft?.value.trim()) {
      setMarks((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          tool: "text",
          color,
          point: textDraft.point,
          text: textDraft.value.trim(),
        },
      ]);
      setRedo([]);
    }
    setTextDraft(null);
  };

  return (
    <div className="absolute inset-0 z-20" data-browser-annotation-layer>
      <svg
        ref={layerRef}
        className={cn(
          "absolute inset-0 size-full touch-none",
          tool === "eraser" ? "cursor-cell" : tool === "text" ? "cursor-text" : "cursor-crosshair",
        )}
        aria-label="Browser annotation canvas"
        onPointerDown={begin}
        onPointerMove={move}
        onPointerUp={finish}
        onPointerCancel={finish}
      >
        {[...marks, ...(draft ? [draft] : [])].map((mark) => (
          <AnnotationShape key={mark.id} mark={mark} />
        ))}
      </svg>

      {textDraft ? (
        <input
          autoFocus
          value={textDraft.value}
          aria-label="Annotation text"
          className={cn(
            "absolute z-10 min-w-40 rounded-md border border-white/20 bg-black/75 px-2 py-1",
            "text-sm text-white shadow-lg outline-none focus:ring-2 focus:ring-white/30",
          )}
          style={{ left: textDraft.point.x, top: textDraft.point.y }}
          onChange={(event) => setTextDraft({ ...textDraft, value: event.target.value })}
          onBlur={commitText}
          onKeyDown={(event) => {
            if (event.key === "Enter") commitText();
            if (event.key === "Escape") setTextDraft(null);
          }}
        />
      ) : null}

      <div
        className={cn(
          "absolute bottom-4 left-1/2 z-20 flex max-w-[calc(100%-24px)] -translate-x-1/2 items-center gap-1 overflow-x-auto rounded-xl border p-1.5 shadow-2xl",
          props.lightChrome
            ? "border-black/10 bg-white/95 text-[#202020]"
            : "border-white/10 bg-[#171717]/95 text-[#eeeeee]",
        )}
        role="toolbar"
        aria-label="Annotation tools"
      >
        <ToolButton label="Pen" active={tool === "pen"} onClick={() => setTool("pen")}>
          <Pencil />
        </ToolButton>
        <ToolButton label="Line" active={tool === "line"} onClick={() => setTool("line")}>
          <Minus className="-rotate-45" />
        </ToolButton>
        <ToolButton
          label="Rectangle"
          active={tool === "rectangle"}
          onClick={() => setTool("rectangle")}
        >
          <Square />
        </ToolButton>
        <ToolButton label="Ellipse" active={tool === "ellipse"} onClick={() => setTool("ellipse")}>
          <Circle />
        </ToolButton>
        <ToolButton label="Text" active={tool === "text"} onClick={() => setTool("text")}>
          <Type />
        </ToolButton>
        <ToolButton label="Eraser" active={tool === "eraser"} onClick={() => setTool("eraser")}>
          <Eraser />
        </ToolButton>
        <span className="mx-1 h-6 w-px shrink-0 bg-current opacity-15" aria-hidden />
        {colors.map((option) => (
          <button
            key={option}
            type="button"
            className={cn(
              "size-6 shrink-0 rounded-full border-2 transition-transform hover:scale-110",
              color === option ? "border-current" : "border-transparent",
            )}
            style={{ backgroundColor: option }}
            aria-label={`Use ${option} ink`}
            aria-pressed={color === option}
            onClick={() => setColor(option)}
          />
        ))}
        <span className="mx-1 h-6 w-px shrink-0 bg-current opacity-15" aria-hidden />
        <ToolButton label="Undo" disabled={!marks.length} onClick={undoLast}>
          <Undo2 />
        </ToolButton>
        <ToolButton label="Redo" disabled={!redo.length} onClick={redoLast}>
          <Redo2 />
        </ToolButton>
        <ToolButton
          label="Clear annotations"
          disabled={!marks.length}
          onClick={() => {
            setMarks([]);
            setRedo([]);
          }}
        >
          <Trash2 />
        </ToolButton>
        <button
          type="button"
          className="ml-1 flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-medium hover:bg-current/10"
          onClick={props.onClose}
        >
          <X size={15} /> Close
        </button>
      </div>
    </div>
  );
}

function ToolButton(props: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-lg transition-colors hover:bg-current/10 disabled:opacity-30",
        props.active && "bg-current/15",
        "[&_svg]:size-4",
      )}
      aria-label={props.label}
      aria-pressed={props.active}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

function AnnotationShape({ mark }: { mark: AnnotationMark }) {
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

function markNearPoint(mark: AnnotationMark, point: Point): boolean {
  if (mark.tool === "text") {
    return Math.hypot(mark.point.x - point.x, mark.point.y - point.y) < 36;
  }
  return mark.points.some(
    (candidate) => Math.hypot(candidate.x - point.x, candidate.y - point.y) < 18,
  );
}
