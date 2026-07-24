import { useCallback, useEffect, useRef, useState } from "react";
import { Layer, Line, Stage } from "react-konva";
import type Konva from "konva";
import { Pen, Redo2, Trash2, Undo2 } from "lucide-react";
import { Button, Slider } from "@/ui";

/** A freehand stroke. `points` are normalized (0–1) relative to the video frame
 *  so annotations stay aligned at any display size and survive persistence. */
type Stroke = { points: number[]; color: string; width: number };

const COLORS = ["#ff3b30", "#ffcc00", "#34c759", "#0a84ff", "#ffffff", "#111111"];
const STORAGE_PREFIX = "misty:video-annotations:";

function storageKeyFor(persistKey?: string): string {
  return persistKey ? `${STORAGE_PREFIX}${persistKey}` : "";
}

function loadStrokes(key: string): Stroke[] {
  if (!key) return [];
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(parsed) ? (parsed as Stroke[]) : [];
  } catch {
    return [];
  }
}

/** Expand normalized points to pixel coordinates for the current stage size. */
function toPixels(points: number[], width: number, height: number): number[] {
  const out: number[] = [];
  for (let index = 0; index < points.length; index += 2) {
    out.push(points[index] * width, points[index + 1] * height);
  }
  return out;
}

export default function VideoAnnotator({
  url,
  name,
  persistKey,
}: {
  url: string;
  name: string;
  /** Stable identity (e.g. file path) used to persist annotations across sessions. */
  persistKey?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const activeStroke = useRef<Stroke | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [drawing, setDrawing] = useState(false);
  const [color, setColor] = useState(COLORS[0]);
  const [brush, setBrush] = useState(4);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [redo, setRedo] = useState<Stroke[]>([]);
  const [live, setLive] = useState<Stroke | null>(null);

  const storageKey = storageKeyFor(persistKey);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const update = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Load persisted annotations when the underlying video changes.
  useEffect(() => {
    setStrokes(loadStrokes(storageKey));
    setRedo([]);
  }, [storageKey]);

  // Persist on every committed change (device-local; swappable for a Tauri fs
  // store or Spaces sync later).
  useEffect(() => {
    if (!storageKey) return;
    try {
      if (strokes.length > 0) localStorage.setItem(storageKey, JSON.stringify(strokes));
      else localStorage.removeItem(storageKey);
    } catch {
      // Ignore storage quota / privacy-mode failures; annotations stay in memory.
    }
  }, [storageKey, strokes]);

  const toggleDraw = useCallback(() => {
    setDrawing((value) => {
      const next = !value;
      if (next) videoRef.current?.pause();
      return next;
    });
  }, []);

  const normalizedPointer = useCallback(
    (event: Konva.KonvaEventObject<PointerEvent>): [number, number] | null => {
      const position = event.target.getStage()?.getPointerPosition();
      if (!position || size.width <= 0 || size.height <= 0) return null;
      return [position.x / size.width, position.y / size.height];
    },
    [size.height, size.width],
  );

  const pointerStart = useCallback(
    (event: Konva.KonvaEventObject<PointerEvent>) => {
      if (!drawing) return;
      const point = normalizedPointer(event);
      if (!point) return;
      const stroke: Stroke = { points: point, color, width: brush };
      activeStroke.current = stroke;
      setLive(stroke);
    },
    [brush, color, drawing, normalizedPointer],
  );

  const pointerMove = useCallback(
    (event: Konva.KonvaEventObject<PointerEvent>) => {
      if (!drawing || !activeStroke.current) return;
      const point = normalizedPointer(event);
      if (!point) return;
      const stroke: Stroke = {
        ...activeStroke.current,
        points: [...activeStroke.current.points, ...point],
      };
      activeStroke.current = stroke;
      setLive(stroke);
    },
    [drawing, normalizedPointer],
  );

  const pointerEnd = useCallback(() => {
    const stroke = activeStroke.current;
    if (!stroke) return;
    activeStroke.current = null;
    setLive(null);
    if (stroke.points.length >= 4) {
      setStrokes((current) => [...current, stroke]);
      setRedo([]);
    }
  }, []);

  const undo = useCallback(() => {
    setStrokes((current) => {
      if (current.length === 0) return current;
      const last = current[current.length - 1];
      setRedo((stack) => [...stack, last]);
      return current.slice(0, -1);
    });
  }, []);

  const redoStroke = useCallback(() => {
    setRedo((stack) => {
      if (stack.length === 0) return stack;
      const next = stack[stack.length - 1];
      setStrokes((current) => [...current, next]);
      return stack.slice(0, -1);
    });
  }, []);

  const clear = useCallback(() => {
    setStrokes([]);
    setRedo([]);
  }, []);

  return (
    <div className="flex h-full w-full flex-col bg-black">
      <div className="flex h-11 flex-none items-center gap-3 border-b border-white/10 bg-[#111216] px-3 text-white">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-white/90" title={name}>
          {name}
        </span>
        <div className="flex flex-none items-center gap-2">
          <Button
            type="button"
            variant={drawing ? "default" : "ghost"}
            size="sm"
            className={drawing ? "" : "text-white/70 hover:bg-white/10 hover:text-white"}
            aria-pressed={drawing}
            onClick={toggleDraw}
          >
            <Pen size={15} />
            {drawing ? "Drawing" : "Draw"}
          </Button>
          {drawing ? (
            <>
              <div className="flex items-center gap-1">
                {COLORS.map((swatch) => (
                  <button
                    key={swatch}
                    type="button"
                    aria-label={`Pen color ${swatch}`}
                    className={`size-5 rounded-full border transition ${
                      color === swatch ? "border-white ring-2 ring-white/40" : "border-white/20"
                    }`}
                    style={{ backgroundColor: swatch }}
                    onClick={() => setColor(swatch)}
                  />
                ))}
              </div>
              <div className="w-20">
                <Slider
                  aria-label="Pen size"
                  value={[brush]}
                  min={2}
                  max={24}
                  step={1}
                  onValueChange={([value]) => setBrush(value ?? brush)}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 text-white/70 hover:bg-white/10 hover:text-white"
                aria-label="Undo"
                disabled={strokes.length === 0}
                onClick={undo}
              >
                <Undo2 size={16} />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 text-white/70 hover:bg-white/10 hover:text-white"
                aria-label="Redo"
                disabled={redo.length === 0}
                onClick={redoStroke}
              >
                <Redo2 size={16} />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 text-white/70 hover:bg-white/10 hover:text-white"
                aria-label="Clear drawing"
                disabled={strokes.length === 0}
                onClick={clear}
              >
                <Trash2 size={16} />
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <div ref={containerRef} className="relative min-h-0 flex-1">
        <video
          ref={videoRef}
          className="absolute inset-0 h-full w-full object-contain"
          src={url}
          controls={!drawing}
          autoPlay
          muted
          playsInline
          preload="metadata"
        />
        {size.width > 0 && size.height > 0 ? (
          <div
            className="absolute inset-0"
            style={{
              pointerEvents: drawing ? "auto" : "none",
              cursor: drawing ? "crosshair" : "default",
              touchAction: drawing ? "none" : "auto",
            }}
          >
            <Stage
              width={size.width}
              height={size.height}
              onPointerDown={pointerStart}
              onPointerMove={pointerMove}
              onPointerUp={pointerEnd}
              onPointerLeave={pointerEnd}
            >
              <Layer listening={false}>
                {strokes.map((stroke, index) => (
                  <Line
                    key={index}
                    points={toPixels(stroke.points, size.width, size.height)}
                    stroke={stroke.color}
                    strokeWidth={stroke.width}
                    lineCap="round"
                    lineJoin="round"
                    tension={0.3}
                  />
                ))}
                {live ? (
                  <Line
                    points={toPixels(live.points, size.width, size.height)}
                    stroke={live.color}
                    strokeWidth={live.width}
                    lineCap="round"
                    lineJoin="round"
                    tension={0.3}
                  />
                ) : null}
              </Layer>
            </Stage>
          </div>
        ) : null}
      </div>
    </div>
  );
}
