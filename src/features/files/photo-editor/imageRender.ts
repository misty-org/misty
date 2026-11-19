import { drawMarks } from "./markRender";
import { prepareStickers, stickersMissing } from "./stickers";
import {
  adjustmentIds,
  fullCrop,
  maxSide,
  outputSize,
  sourceToDrawing,
  turnedSize,
  type AdjustmentId,
  type Adjustments,
  type FilterId,
  type ImageEdit,
} from "./imageEdit";

/** An image ready to draw: decoded once, drawn many times. */
export interface PhotoSource {
  image: CanvasImageSource;
  width: number;
  height: number;
}

/** The most pixels a saved image may have, so a huge photo can't exhaust the webview. */
const maxSavedPixels = 64_000_000;

/** What a drawing of the edit used: the source drawn, and how many drawing pixels per frame pixel. */
export interface Drawn {
  source: PhotoSource;
  scale: number;
  crop: boolean;
}

/**
 * Draws the photo with its turn, mirror, straightening, crop, light and color into `canvas` (a new
 * one if none is given), without marks. `crop: false` draws the whole frame, for cropping over it;
 * `maxSide` caps the longer side, for previews.
 */
export function renderPhoto(
  source: PhotoSource,
  edit: ImageEdit,
  options: { canvas?: HTMLCanvasElement; maxSide?: number; crop?: boolean } = {},
): { canvas: HTMLCanvasElement; drawn: Drawn } {
  const crop = options.crop !== false;
  const frame = turnedSize(source.width, source.height, edit.rotation);
  const cropRect = crop ? edit.crop : fullCrop;
  const cropWidth = cropRect.width * frame.width;
  const cropHeight = cropRect.height * frame.height;
  let scale = options.maxSide ? Math.min(1, options.maxSide / Math.max(cropWidth, cropHeight)) : 1;
  scale = Math.min(scale, Math.sqrt(maxSavedPixels / Math.max(1, cropWidth * cropHeight)));

  const canvas = options.canvas ?? document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(cropWidth * scale));
  canvas.height = Math.max(1, Math.round(cropHeight * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("The image could not be drawn.");
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.setTransform(sourceToDrawing(edit, source, { scale, crop }));
  context.drawImage(source.image, 0, 0, source.width, source.height);
  context.setTransform(1, 0, 0, 1, 0, 0);
  applyTone(context, canvas.width, canvas.height, edit);
  return { canvas, drawn: { source, scale, crop } };
}

/**
 * The whole edit, ready to save: the photo, its marks over it, at its saved size. Drawn from the
 * full-size original. Its stickers must be loaded (`renderEdit` waits for them): an edit with one
 * still loading isn't drawn at all, so nothing is ever saved with a sticker missing.
 */
export function renderFinal(source: PhotoSource, edit: ImageEdit): HTMLCanvasElement {
  if (stickersMissing(edit.marks).length)
    throw new Error("A sticker on the image hasn’t loaded yet. Try again.");
  const { canvas, drawn } = renderPhoto(source, edit);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The image could not be drawn.");
  // Redactions blur the photo as it was before any marks were drawn over it.
  const photo =
    edit.marks && Object.values(edit.marks).some((mark) => mark.kind === "redact")
      ? copyOf(canvas)
      : canvas;
  drawMarks(context, edit, drawn, { photo });
  if (!edit.resize) return canvas;
  const size = outputSize(source, edit);
  const width = Math.min(maxSide, size.width);
  const height = Math.min(maxSide, size.height);
  if (width === canvas.width && height === canvas.height) return canvas;
  return resample(canvas, width, height);
}

/** The whole edit, ready to save, once every sticker on it has loaded. */
export async function renderEdit(source: PhotoSource, edit: ImageEdit): Promise<HTMLCanvasElement> {
  await prepareStickers(edit.marks);
  return renderFinal(source, edit);
}

function copyOf(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const copy = document.createElement("canvas");
  copy.width = canvas.width;
  copy.height = canvas.height;
  copy.getContext("2d")?.drawImage(canvas, 0, 0);
  return copy;
}

/** A smaller or larger copy, stepping down by halves so a big shrink stays sharp. */
function resample(from: HTMLCanvasElement, width: number, height: number): HTMLCanvasElement {
  let current = from;
  while (current.width / 2 >= width && current.height / 2 >= height) {
    const half = document.createElement("canvas");
    half.width = Math.max(width, Math.round(current.width / 2));
    half.height = Math.max(height, Math.round(current.height / 2));
    const context = half.getContext("2d");
    if (!context) break;
    context.imageSmoothingQuality = "high";
    context.drawImage(current, 0, 0, half.width, half.height);
    current = half;
  }
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const context = out.getContext("2d");
  if (!context) throw new Error("The image could not be resized.");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(current, 0, 0, width, height);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Light and color

/** Each filter is a set of adjustments laid over the person's own, and maybe black and white. */
const filterLooks: Record<FilterId, { adjust: Partial<Adjustments>; mono?: boolean }> = {
  none: { adjust: {} },
  vivid: { adjust: { saturation: 30, vibrance: 25, contrast: 12 } },
  dramatic: { adjust: { contrast: 38, highlights: -20, shadows: -18, saturation: -12 } },
  warm: { adjust: { warmth: 38, saturation: 8 } },
  cool: { adjust: { warmth: -38, tint: -6 } },
  fade: { adjust: { contrast: -28, shadows: 28, saturation: -22 } },
  mono: { adjust: { contrast: 12 }, mono: true },
  noir: { adjust: { contrast: 48, exposure: -10, shadows: -24 }, mono: true },
};

/** The person's adjustments with the filter's laid over them, each -1 to 1. */
function toneOf(edit: Pick<ImageEdit, "adjust" | "filter" | "filterStrength">) {
  const look = filterLooks[edit.filter];
  const strength = Math.max(0, Math.min(1, edit.filterStrength / 100));
  const amount = (id: AdjustmentId) =>
    Math.max(-1, Math.min(1, ((edit.adjust[id] ?? 0) + (look.adjust[id] ?? 0) * strength) / 100));
  return {
    mono: look.mono ? strength : 0,
    ...(Object.fromEntries(adjustmentIds.map((id) => [id, amount(id)])) as Adjustments),
  };
}

const smoothstep = (low: number, high: number, value: number) => {
  const t = Math.min(1, Math.max(0, (value - low) / (high - low)));
  return t * t * (3 - 2 * t);
};

/** Light, color, detail and the vignette, pixel by pixel, in place. */
function applyTone(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  edit: ImageEdit,
) {
  const tone = toneOf(edit);
  if (!tone.mono && adjustmentIds.every((id) => tone[id] === 0)) return;
  const image = context.getImageData(0, 0, width, height);
  const data = image.data;
  const exposure = 2 ** tone.exposure;
  const contrast = tone.contrast >= 0 ? 1 + tone.contrast : 1 + tone.contrast * 0.8;
  const brightness = tone.brightness * 0.5;
  const warmth = tone.warmth * 0.09;
  const tint = tone.tint * 0.06;
  const centerX = width / 2;
  const centerY = height / 2;
  const reach = Math.hypot(centerX, centerY) || 1;
  const toned = tone.mono > 0 || adjustmentIds.some((id) => id !== "sharpness" && tone[id] !== 0);

  if (toned) {
    for (let y = 0; y < height; y++) {
      // The vignette depends only on the distance from the middle.
      const rowY = (y - centerY) ** 2;
      for (let x = 0; x < width; x++) {
        const index = (y * width + x) * 4;
        let r = (data[index] / 255) * exposure;
        let g = (data[index + 1] / 255) * exposure;
        let b = (data[index + 2] / 255) * exposure;
        if (brightness > 0) {
          r += (1 - r) * brightness;
          g += (1 - g) * brightness;
          b += (1 - b) * brightness;
        } else if (brightness < 0) {
          r *= 1 + brightness;
          g *= 1 + brightness;
          b *= 1 + brightness;
        }
        r = (r - 0.5) * contrast + 0.5;
        g = (g - 0.5) * contrast + 0.5;
        b = (b - 0.5) * contrast + 0.5;

        let light = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        if (tone.shadows || tone.highlights) {
          const lifted =
            tone.shadows * 0.35 * (1 - light) ** 2 + tone.highlights * 0.35 * light * light;
          r += lifted;
          g += lifted;
          b += lifted;
          light += lifted;
        }
        if (tone.saturation || tone.vibrance) {
          const spread = Math.max(r, g, b) - Math.min(r, g, b);
          const boost = 1 + tone.saturation + tone.vibrance * (1 - Math.min(1, spread * 1.5));
          r = light + (r - light) * boost;
          g = light + (g - light) * boost;
          b = light + (b - light) * boost;
        }
        if (tone.mono) {
          r += (light - r) * tone.mono;
          g += (light - g) * tone.mono;
          b += (light - b) * tone.mono;
        }
        if (warmth || tint) {
          r += warmth + tint * 0.5;
          g -= tint;
          b += -warmth + tint * 0.5;
        }
        if (tone.vignette) {
          const edge = smoothstep(0.35, 1, Math.sqrt(rowY + (x - centerX) ** 2) / reach);
          const shade = tone.vignette > 0 ? 1 - tone.vignette * 0.75 * edge : 1;
          const glow = tone.vignette < 0 ? -tone.vignette * 0.6 * edge : 0;
          r = r * shade + (1 - r) * glow;
          g = g * shade + (1 - g) * glow;
          b = b * shade + (1 - b) * glow;
        }
        data[index] = r * 255;
        data[index + 1] = g * 255;
        data[index + 2] = b * 255;
      }
    }
  }
  if (tone.sharpness) applyDetail(data, width, height, tone.sharpness);
  context.putImageData(image, 0, 0);
}

/**
 * Sharpens (above 0) or softens (below 0) against a 3×3 blur of the image: an unsharp mask one
 * way, a blend toward the blur the other.
 */
function applyDetail(data: Uint8ClampedArray, width: number, height: number, amount: number) {
  if (width < 3 || height < 3) return;
  const source = new Uint8ClampedArray(data);
  const strength = amount > 0 ? amount * 1.6 : amount;
  const row = width * 4;
  for (let y = 0; y < height; y++) {
    const up = y > 0 ? -row : 0;
    const down = y < height - 1 ? row : 0;
    for (let x = 0; x < width; x++) {
      const index = y * row + x * 4;
      const left = x > 0 ? -4 : 0;
      const right = x < width - 1 ? 4 : 0;
      for (let channel = 0; channel < 3; channel++) {
        const at = index + channel;
        const blur =
          (source[at + up + left] +
            source[at + up] +
            source[at + up + right] +
            source[at + left] +
            source[at] +
            source[at + right] +
            source[at + down + left] +
            source[at + down] +
            source[at + down + right]) /
          9;
        const value = source[at];
        data[at] =
          amount > 0 ? value + strength * (value - blur) : value + -strength * (blur - value);
      }
    }
  }
}

/**
 * Light and contrast that suit the photo: the exposure that brings its middle tone near the middle,
 * and the contrast that spreads its tones across the range, held back so the photo stays itself.
 */
export function autoAdjustments(source: PhotoSource): Partial<Adjustments> {
  const small = workingCopy(source, 256);
  const canvas = document.createElement("canvas");
  canvas.width = small.width;
  canvas.height = small.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return {};
  context.drawImage(small.image, 0, 0, small.width, small.height);
  const { data } = context.getImageData(0, 0, small.width, small.height);
  const histogram = new Uint32Array(256);
  let total = 0;
  let sum = 0;
  let saturation = 0;
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] < 16) continue;
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    const light = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
    histogram[light] += 1;
    sum += light;
    saturation += (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
    total += 1;
  }
  if (!total) return {};
  const percentile = (fraction: number) => {
    let seen = 0;
    for (let level = 0; level < 256; level++) {
      seen += histogram[level];
      if (seen >= total * fraction) return level / 255;
    }
    return 1;
  };
  const low = percentile(0.01);
  const high = percentile(0.99);
  const mean = sum / total / 255;
  const round = (value: number, limit: number) =>
    Math.round(Math.max(-limit, Math.min(limit, value)));
  const exposure = round(Math.log2(0.48 / Math.max(0.02, mean)) * 55, 60);
  const contrast = round((1 / Math.max(0.2, high - low) - 1) * 45, 45);
  const vibrance = round((0.32 - saturation / total) * 90, 30);
  return {
    exposure,
    contrast: Math.max(0, contrast),
    highlights: high > 0.97 ? -15 : 0,
    shadows: low < 0.03 ? 12 : 0,
    vibrance: Math.max(0, vibrance),
  };
}

// ---------------------------------------------------------------------------------------------
// Loading and saving

/** Decodes an image from a URL or bytes, upright as its camera took it. */
export async function loadPhoto(from: string | Blob): Promise<PhotoSource> {
  const url = typeof from === "string" ? from : URL.createObjectURL(from);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    return { image, width: image.naturalWidth, height: image.naturalHeight };
  } finally {
    // The decoded image keeps its pixels; the URL made here is no longer needed.
    if (typeof from !== "string") URL.revokeObjectURL(url);
  }
}

/**
 * The images decoded lately, by URL, so stepping back and forth between a few (or opening one
 * decoded ahead of time) shows it at once. Decoded pixels are large, so only a few are kept.
 */
const decoded = new Map<string, { pending: Promise<PhotoSource>; photo?: PhotoSource }>();
const decodedMost = 4;

/** Decodes the image at this URL, once while it is among the few opened lately. */
export function openPhoto(url: string): Promise<PhotoSource> {
  const known = decoded.get(url);
  if (known) {
    decoded.delete(url);
    decoded.set(url, known);
    return known.pending;
  }
  const entry: { pending: Promise<PhotoSource>; photo?: PhotoSource } = {
    pending: loadPhoto(url),
  };
  entry.pending.then(
    (photo) => {
      entry.photo = photo;
    },
    // A failed decode isn't kept: opening it again tries again.
    () => {
      if (decoded.get(url) === entry) decoded.delete(url);
    },
  );
  decoded.set(url, entry);
  for (const key of decoded.keys()) {
    if (decoded.size <= decodedMost) break;
    decoded.delete(key);
  }
  return entry.pending;
}

/** The image at this URL, when it is already decoded. */
export function decodedPhoto(url: string): PhotoSource | undefined {
  return decoded.get(url)?.photo;
}

/** Decodes it ahead of being opened, as the image after the one on screen. Failures are quiet. */
export function preloadPhoto(url: string) {
  openPhoto(url).catch(() => undefined);
}

/** A smaller copy for previews and filter thumbnails, so dragging a slider stays smooth. */
export function workingCopy(source: PhotoSource, longest: number): PhotoSource {
  const scale = Math.min(1, longest / Math.max(source.width, source.height));
  if (scale === 1) return source;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const context = canvas.getContext("2d");
  if (!context) return source;
  context.imageSmoothingQuality = "high";
  context.drawImage(source.image, 0, 0, canvas.width, canvas.height);
  return { image: canvas, width: canvas.width, height: canvas.height };
}

/** The formats an image can be saved as. */
export const imageFormats = [
  { mimeType: "image/png", label: "PNG", extension: "png", lossy: false },
  { mimeType: "image/jpeg", label: "JPEG", extension: "jpg", lossy: true },
  { mimeType: "image/webp", label: "WebP", extension: "webp", lossy: true },
] as const;
export type ImageMimeType = (typeof imageFormats)[number]["mimeType"];

/** How the edit is saved: its format and, for JPEG and WebP, its quality (0 to 1). */
export interface SaveFormat {
  mimeType: ImageMimeType;
  quality: number;
}

/** The quality JPEG and WebP save at unless another is chosen. */
export const defaultQuality = 0.92;

/** The image's own format when it is one the editor saves, else PNG. */
export function saveFormatFor(mimeType: string): SaveFormat {
  const format = imageFormats.find((candidate) => candidate.mimeType === mimeType);
  return { mimeType: format?.mimeType ?? "image/png", quality: defaultQuality };
}

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality = defaultQuality,
): Promise<Blob> {
  const lossy = mimeType !== "image/png";
  // JPEG has no transparency: what was clear saves as white, not black.
  const target = mimeType === "image/jpeg" ? flattened(canvas) : canvas;
  return new Promise((resolve, reject) => {
    target.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("The edited image could not be encoded.")),
      mimeType,
      lossy ? quality : undefined,
    );
  });
}

function flattened(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = canvas.width;
  out.height = canvas.height;
  const context = out.getContext("2d");
  if (!context) return canvas;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, out.width, out.height);
  context.drawImage(canvas, 0, 0);
  return out;
}
