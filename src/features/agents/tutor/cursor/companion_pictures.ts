import { invoke } from "@/native/invoke";
import type { SketchElement } from "./companion_sketch";

const PICTURE_SIDE = 480;
const KEPT = 40;

const pictures = new Map<string, string>();
const fetching = new Set<string>();

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
