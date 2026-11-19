import { opencutAssetUrl } from "@opencut/assets";
import { useEffect, useState } from "react";
import { readBundledText } from "../api/bundledAsset";
import type { Mark, StickerMark } from "./imageEdit";
import { stickerById, type FlagSticker, type ShapeSticker, type Sticker } from "./stickerCatalog";

/**
 * Drawing stickers. A shape is drawn by its OpenCut graphics definition at the size it lands at,
 * so it is sharp at any size, in the mark's color. A flag is OpenCut's bundled picture, which
 * loads once; anything that draws the edit for keeps (saving, copying, an agent's view) waits for
 * `prepareStickers` first, and `renderFinal` refuses to draw an edit whose flags aren't loaded,
 * so a saved image never misses one. The live view draws what has loaded and draws again as the
 * rest arrive.
 */

/** The largest side a shape is drawn at before it is scaled, so a huge box can't exhaust memory. */
const largestShape = 4096;

/** A flag's picture URL: OpenCut's own path, bundled from its public folder. */
export function flagUrl(sticker: FlagSticker): string {
  return opencutAssetUrl(`/flags/${encodeURIComponent(sticker.code.toLowerCase())}.svg`);
}

// ---------------------------------------------------------------------------------------------
// Flags, loaded once

const flagImages = new Map<
  string,
  { pending: Promise<HTMLImageElement>; image?: HTMLImageElement }
>();
const listeners = new Set<() => void>();

/**
 * The flag's SVG with its size written on it. flag-icons' files give only a viewBox, and WebKit
 * draws a picture with no size of its own onto a canvas at nothing.
 */
export function sizedSvg(svg: string): string {
  const open = svg.match(/<svg\b[^>]*>/i);
  if (!open) return svg;
  const tag = open[0];
  if (/\swidth\s*=/i.test(tag)) return svg;
  const box = tag.match(
    /viewBox\s*=\s*["']\s*-?[\d.]+[\s,]+-?[\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*["']/i,
  );
  const [width, height] = box ? [box[1], box[2]] : ["640", "480"];
  return svg.replace(tag, tag.replace(/^<svg\b/i, `<svg width="${width}" height="${height}"`));
}

async function decodeFlag(sticker: FlagSticker): Promise<HTMLImageElement> {
  const text = await readBundledText(flagUrl(sticker));
  if (text === null) throw new Error(`The ${sticker.name} sticker couldn’t be loaded.`);
  const svg = sizedSvg(text);
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    return image;
  } catch {
    throw new Error(`The ${sticker.name} sticker couldn’t be loaded.`);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadFlag(sticker: FlagSticker): Promise<HTMLImageElement> {
  const known = flagImages.get(sticker.id);
  if (known) return known.pending;
  const entry: { pending: Promise<HTMLImageElement>; image?: HTMLImageElement } = {
    pending: decodeFlag(sticker),
  };
  entry.pending.then(
    (image) => {
      entry.image = image;
      for (const listener of listeners) listener();
    },
    // A failed load isn't kept: the next draw tries again.
    () => {
      if (flagImages.get(sticker.id) === entry) flagImages.delete(sticker.id);
    },
  );
  flagImages.set(sticker.id, entry);
  return entry.pending;
}

const stickerMarks = (marks: Record<string, Mark>) =>
  Object.values(marks).filter((mark): mark is StickerMark => mark.kind === "sticker");

/** Whether a sticker can be drawn now: a shape always, a flag once its picture has loaded. */
export function stickerReady(id: string): boolean {
  const sticker = stickerById(id);
  if (!sticker) return false;
  return sticker.set === "shapes" || Boolean(flagImages.get(id)?.image);
}

/** The stickers among these marks that can't be drawn yet. */
export function stickersMissing(marks: Record<string, Mark>): string[] {
  return [
    ...new Set(
      stickerMarks(marks)
        .map((mark) => mark.sticker)
        .filter((id) => !stickerReady(id)),
    ),
  ];
}

/** Loads every sticker the marks use; it fails when one can't be loaded. */
export async function prepareStickers(marks: Record<string, Mark>): Promise<void> {
  const loads: Promise<unknown>[] = [];
  for (const id of new Set(stickerMarks(marks).map((mark) => mark.sticker))) {
    const sticker = stickerById(id);
    if (!sticker) throw new Error("The image has a sticker Misty doesn’t have.");
    if (sticker.set === "flags") loads.push(loadFlag(sticker));
  }
  await Promise.all(loads);
}

/**
 * Starts loading the marks' stickers and answers a number that changes each time one arrives, so
 * the live view draws them as they come.
 */
export function useStickersLoaded(marks: Record<string, Mark>): number {
  const [arrived, setArrived] = useState(0);
  const wanted = [...new Set(stickerMarks(marks).map((mark) => mark.sticker))].sort().join(",");
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    const bump = () => live && setArrived((count) => count + 1);
    listeners.add(bump);
    for (const id of wanted.split(",")) {
      const sticker = stickerById(id);
      if (sticker?.set === "flags") loadFlag(sticker).catch((error) => console.error(error));
    }
    return () => {
      live = false;
      listeners.delete(bump);
    };
  }, [wanted]);
  return arrived;
}

// ---------------------------------------------------------------------------------------------
// Shapes, drawn to size

/** Shapes drawn lately, so redrawing the view doesn't draw them again; large ones aren't kept. */
const shapeCache = new Map<string, HTMLCanvasElement>();
const shapeCacheMost = 16;
const shapeCachePixels = 1024 * 1024;

/** A shape's own settings (its outline, corners, points), as OpenCut starts a new one. */
function shapeDefaults(sticker: ShapeSticker): Record<string, string | number | boolean> {
  return Object.fromEntries(sticker.graphic.params.map((param) => [param.key, param.default]));
}

/** A shape sticker drawn at exactly `width` × `height` pixels in `color`. */
export function shapePicture(
  sticker: ShapeSticker,
  color: string,
  width: number,
  height: number,
): HTMLCanvasElement {
  const key = `${sticker.id}|${color}|${width}x${height}`;
  const known = shapeCache.get(key);
  if (known) {
    shapeCache.delete(key);
    shapeCache.set(key, known);
    return known;
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (context)
    sticker.graphic.render({
      ctx: context,
      params: { ...shapeDefaults(sticker), fill: color },
      width,
      height,
    });
  if (width * height > shapeCachePixels) return canvas;
  shapeCache.set(key, canvas);
  for (const old of shapeCache.keys()) {
    if (shapeCache.size <= shapeCacheMost) break;
    shapeCache.delete(old);
  }
  return canvas;
}

/** A small picture of a sticker for the Stickers tab: a shape in `color`, a flag as it is. */
export function stickerPreview(sticker: Sticker, color: string): string {
  return sticker.set === "flags"
    ? flagUrl(sticker)
    : shapePicture(sticker, color, 96, 96).toDataURL("image/png");
}

/**
 * Draws a sticker mark in the original's pixel space (the context's transform takes it to the
 * drawing). It answers false when its picture hasn't loaded, and draws nothing then.
 */
export function drawSticker(
  context: CanvasRenderingContext2D,
  mark: StickerMark,
  side: number,
): boolean {
  const sticker = stickerById(mark.sticker);
  if (!sticker) return false;
  const x = mark.box.x * side;
  const y = mark.box.y * side;
  const width = mark.box.width * side;
  const height = mark.box.height * side;
  if (width <= 0 || height <= 0) return true;
  context.globalAlpha = mark.opacity;
  if (sticker.set === "shapes") {
    // Drawn at the size it lands at on the drawing, so it stays sharp.
    const transform = context.getTransform();
    const scale = Math.hypot(transform.a, transform.b) || 1;
    const pixels = (length: number) =>
      Math.max(1, Math.min(largestShape, Math.round(length * scale)));
    context.drawImage(
      shapePicture(sticker, mark.color, pixels(width), pixels(height)),
      x,
      y,
      width,
      height,
    );
    return true;
  }
  const image = flagImages.get(sticker.id)?.image;
  if (!image) return false;
  context.drawImage(image, x, y, width, height);
  return true;
}
