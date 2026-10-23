/**
 * Drawings in companion replies (server companion_sketch_prompt.txt): a fenced
 * ```misty-sketch block in JSON Lines, a header and then one element per line, so a
 * drawing renders while it streams. "board" is a whiteboard beside the cursor; "screen"
 * marks what the person is looking at, in that screenshot's pixels.
 */
type SketchSurface = "board" | "screen";

interface SketchHeader {
  surface: SketchSurface;
  title?: string;
  /** For screen marks: the screenshot the coordinates belong to. */
  screen?: string;
}

type SketchElementType = "rectangle" | "ellipse" | "diamond" | "text" | "arrow" | "line";

export interface SketchElement {
  id: string;
  type: SketchElementType;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  label?: string;
  text?: string;
  from?: string;
  to?: string;
  points?: [number, number][];
}

export interface Sketch {
  header: SketchHeader;
  elements: SketchElement[];
  /** The block is closed: no more elements will arrive. */
  done: boolean;
}

export const MAX_SKETCH_ELEMENTS = 80;
const types = new Set<SketchElementType>([
  "rectangle",
  "ellipse",
  "diamond",
  "text",
  "arrow",
  "line",
]);
const FENCE = "```misty-sketch";

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const clampSize = (value: unknown) =>
  finite(value) ? Math.min(4000, Math.max(1, value)) : undefined;
const short = (value: unknown, max = 80) =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;

function element(value: unknown, seen: Set<string>): SketchElement | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const id = short(raw.id, 60);
  const type = raw.type as SketchElementType;
  if (!id || seen.has(id) || !types.has(type)) return undefined;
  const out: SketchElement = { id, type };
  if (finite(raw.x)) out.x = raw.x;
  if (finite(raw.y)) out.y = raw.y;
  const width = clampSize(raw.width);
  const height = clampSize(raw.height);
  if (width) out.width = width;
  if (height) out.height = height;
  const label = short(raw.label);
  if (label) out.label = label;
  const text = short(raw.text, 200);
  if (text) out.text = text;
  if (type === "arrow" || type === "line") {
    const from = short(raw.from, 60);
    const to = short(raw.to, 60);
    if (from) out.from = from;
    if (to) out.to = to;
    if (Array.isArray(raw.points)) {
      const points = raw.points
        .filter((p): p is [number, number] => Array.isArray(p) && finite(p[0]) && finite(p[1]))
        .slice(0, 20)
        .map(([x, y]) => [x, y] as [number, number]);
      if (points.length >= 2) out.points = points;
    }
    if (!out.points && !(out.from && out.to)) return undefined;
  } else if (type === "text") {
    if (!out.text || out.x === undefined || out.y === undefined) return undefined;
  } else if (out.x === undefined || out.y === undefined || !out.width || !out.height) {
    return undefined;
  }
  seen.add(id);
  return out;
}

/**
 * The reply's drawing so far, or undefined without one. A last line still being
 * written is skipped until it completes; bad lines are dropped, never fatal.
 */
export function parseSketch(content: string): Sketch | undefined {
  const start = content.indexOf(FENCE);
  if (start < 0) return undefined;
  const bodyStart = content.indexOf("\n", start);
  if (bodyStart < 0) return undefined;
  const close = content.indexOf("```", bodyStart);
  const done = close >= 0;
  const body = content.slice(bodyStart + 1, done ? close : undefined);
  const lines = body.split("\n");
  // Without a closing fence the last line may be cut mid-object.
  if (!done) lines.pop();
  let header: SketchHeader | undefined;
  const elements: SketchElement[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let value: unknown;
    try {
      value = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!header) {
      const raw = value as Record<string, unknown> | null;
      if (raw?.surface !== "board" && raw?.surface !== "screen") return undefined;
      header = {
        surface: raw.surface,
        ...(short(raw.title) ? { title: short(raw.title) } : {}),
        ...(typeof raw.screen === "string" && /^(screen|window|focus)\d+$/.test(raw.screen)
          ? { screen: raw.screen }
          : {}),
      };
      continue;
    }
    if (elements.length >= MAX_SKETCH_ELEMENTS) break;
    const parsed = element(value, seen);
    if (parsed) elements.push(parsed);
  }
  return header ? { header, elements, done } : undefined;
}

/** The reply without its drawing, for speech and the pointing bubble. */
export function withoutSketch(content: string): string {
  const start = content.indexOf(FENCE);
  if (start < 0) return content;
  const close = content.indexOf("```", content.indexOf("\n", start) + 1);
  const end = close < 0 || content.indexOf("\n", start) < 0 ? content.length : close + 3;
  return (content.slice(0, start) + content.slice(end)).replace(/\n{3,}/g, "\n\n").trim();
}

/** A label as Excalidraw's skeleton takes it. */
const labelOf = (text?: string) => (text ? { label: { text } } : {});

/**
 * Excalidraw element skeletons for convertToExcalidrawElements: shapes keep their
 * boxes, arrows bind to the elements they join or follow their points, and every
 * stroke is the same near-black with no fill.
 */
export function sketchSkeleton(elements: SketchElement[], strokeColor = "#1e1e1e") {
  const ids = new Set(elements.map((e) => e.id));
  const style = { strokeColor, backgroundColor: "transparent", roughness: 1 };
  return elements.flatMap((e): Record<string, unknown>[] => {
    if (e.type === "text")
      return [{ type: "text" as const, id: e.id, x: e.x!, y: e.y!, text: e.text!, ...style }];
    if (e.type === "arrow" || e.type === "line") {
      const bound = e.from && e.to && ids.has(e.from) && ids.has(e.to);
      if (!bound && !e.points) return [];
      const [origin = [0, 0], ...rest] = e.points ?? [];
      return [
        {
          type: e.type,
          id: e.id,
          x: bound ? 0 : origin[0],
          y: bound ? 0 : origin[1],
          ...(e.points
            ? { points: [[0, 0], ...rest.map(([x, y]) => [x - origin[0], y - origin[1]])] }
            : {}),
          ...(bound ? { start: { id: e.from }, end: { id: e.to } } : {}),
          ...labelOf(e.label),
          ...style,
        },
      ];
    }
    return [
      {
        type: e.type,
        id: e.id,
        x: e.x!,
        y: e.y!,
        width: e.width!,
        height: e.height!,
        ...labelOf(e.label),
        ...style,
      },
    ];
  });
}

/** The box around a sketch's elements, in its own coordinates. */
export function sketchBounds(elements: SketchElement[]) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const e of elements) {
    for (const [x, y] of e.points ?? []) {
      xs.push(x);
      ys.push(y);
    }
    if (e.x !== undefined && e.y !== undefined) {
      xs.push(e.x, e.x + (e.width ?? (e.text ? e.text.length * 9 : 0)));
      ys.push(e.y, e.y + (e.height ?? 24));
    }
  }
  if (!xs.length) return undefined;
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** Moves every coordinate of a sketch: scale, then offset. */
export function mapSketch(
  elements: SketchElement[],
  map: { scaleX: number; scaleY: number; dx: number; dy: number },
): SketchElement[] {
  const x = (v: number) => v * map.scaleX + map.dx;
  const y = (v: number) => v * map.scaleY + map.dy;
  return elements.map((e) => ({
    ...e,
    ...(e.x !== undefined ? { x: x(e.x) } : {}),
    ...(e.y !== undefined ? { y: y(e.y) } : {}),
    ...(e.width !== undefined ? { width: e.width * map.scaleX } : {}),
    ...(e.height !== undefined ? { height: e.height * map.scaleY } : {}),
    ...(e.points ? { points: e.points.map(([px, py]) => [x(px), y(py)] as [number, number]) } : {}),
  }));
}
