import { invoke } from "@/native/invoke";
import { sketchInk } from "@/shared/ui";
import type { DisplayCapture } from "./protocol";

/** A trail shorter than this (in global units) is a pointer that drifted, not something drawn. */
const DRAWN_LENGTH = 80;

/** What the engine is told when the screenshots carry the person's trail. */
export const trailNote =
  "The red line on the screenshots is what they drew with the pointer while asking: whatever it " +
  "circles, underlines, crosses or points at is what they mean by this, that or here.";

/**
 * The screens with the trail the person drew while holding the talk keys (spatial context) drawn
 * on each screenshot it crosses, in red, so the engine sees what they circled or scribbled over.
 * `drawn` says whether there was a trail to draw.
 */
export async function withTrail(
  screens: DisplayCapture[],
  turn: number,
): Promise<{ screens: DisplayCapture[]; drawn: boolean }> {
  const trail = await invoke<[number, number][]>("cursor_companion_trail", { turn }).catch(
    () => [] as [number, number][],
  );
  let length = 0;
  for (let i = 1; i < trail.length; i++)
    length += Math.hypot(trail[i]![0] - trail[i - 1]![0], trail[i]![1] - trail[i - 1]![1]);
  if (length < DRAWN_LENGTH) return { screens, drawn: false };
  let drawn = false;
  const marked = await Promise.all(
    screens.map(async (capture) => {
      const out = await drawTrail(capture, trail).catch(() => undefined);
      if (!out) return capture;
      drawn = true;
      return out;
    }),
  );
  return { screens: marked, drawn };
}

/** One screenshot with the part of the trail over it drawn on, or undefined when none is. */
async function drawTrail(capture: DisplayCapture, trail: [number, number][]) {
  const frame = capture.display;
  if (!frame.width || !frame.height || !capture.width || !capture.height) return undefined;
  const sx = capture.width / frame.width;
  const sy = capture.height / frame.height;
  const points = trail.map(([x, y]) => [(x - frame.x) * sx, (y - frame.y) * sy] as const);
  const inside = points.filter(
    ([x, y]) => x >= 0 && y >= 0 && x <= capture.width && y <= capture.height,
  );
  if (inside.length < 2) return undefined;
  const image = new Image();
  image.src = capture.dataUrl;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = capture.width;
  canvas.height = capture.height;
  const context = canvas.getContext("2d");
  if (!context) return undefined;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  context.strokeStyle = sketchInk.board.red;
  context.lineWidth = Math.max(4, capture.width / 320);
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  points.forEach(([x, y], i) => (i ? context.lineTo(x, y) : context.moveTo(x, y)));
  context.stroke();
  return {
    ...capture,
    dataUrl: canvas.toDataURL(capture.mimeType === "image/png" ? "image/png" : "image/jpeg", 0.85),
    mimeType: capture.mimeType === "image/png" ? ("image/png" as const) : ("image/jpeg" as const),
    contentHash: `${capture.contentHash}:trail`,
    trail: true,
  };
}
