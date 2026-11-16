import { invoke } from "@/native/invoke";
import type { SketchElement } from "./companionSketch";

/** The longest side a drawing's picture keeps: enough for a card, small enough to send around. */
const PICTURE_SIDE = 480;
/** Pictures kept for this session; the oldest go first. */
const KEPT = 40;

/** Each picture's data URL, or "" when it couldn't be shown; absent while it's being fetched. */
const pictures = new Map<string, string>();
const fetching = new Set<string>();

/**
 * A drawing's elements with their pictures filled in (`src`), fetching those not here yet
 * through native code (`tutor_picture`: public addresses only, no cookies). `arrived` runs once
 * a fetched picture is ready, so the drawing can be shown again with it.
 */
export function withPictures(elements: SketchElement[], arrived: () => void): SketchElement[] {
  return elements.map((element) => {
    if (element.type !== "image" || !element.url) return element;
    const src = pictures.get(element.url);
    if (src === undefined) fetchPicture(element.url, arrived);
    return src ? { ...element, src } : element;
  });
}

function fetchPicture(url: string, arrived: () => void) {
  if (fetching.has(url)) return;
  fetching.add(url);
  void invoke<string>("tutor_picture", { url })
    .then(shrink)
    .catch(() => "")
    .then((src) => {
      fetching.delete(url);
      if (pictures.size >= KEPT) pictures.delete(pictures.keys().next().value!);
      pictures.set(url, src);
      if (src) arrived();
    });
}

/** The picture at most `PICTURE_SIDE` on its longest side, as a JPEG data URL. */
async function shrink(dataUrl: string): Promise<string> {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  const scale = Math.min(1, PICTURE_SIDE / Math.max(image.naturalWidth, image.naturalHeight, 1));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) return "";
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.82);
}
