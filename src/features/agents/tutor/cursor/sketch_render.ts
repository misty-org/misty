import type { SketchInk } from "@misty/ui";
import { sketchBounds, sketchSkeleton, type SketchElement } from "./companion_sketch";

export const SKETCH_PADDING = 16;

export async function renderSketch(
  elements: SketchElement[],
  ink: SketchInk,
): Promise<
  | { svg: SVGSVGElement; bounds: { x: number; y: number; width: number; height: number } }
  | undefined
> {
  if (!elements.length) return undefined;
  const { convertToExcalidrawElements, exportToSvg, getCommonBounds } =
    await import("@excalidraw/excalidraw");
  const scene = convertToExcalidrawElements(
    sketchSkeleton(elements, ink) as Parameters<typeof convertToExcalidrawElements>[0],
    { regenerateIds: false },
  );
  if (!scene.length) return undefined;
  const files = Object.fromEntries(
    elements
      .filter((e) => e.type === "image" && e.src)
      .map((e) => [
        e.id,
        {
          id: e.id,
          dataURL: e.src!,
          mimeType: e.src!.slice(5, e.src!.indexOf(";")),
          created: 0,
        },
      ]),
  );
  const svg = await exportToSvg({
    elements: scene,
    files: (Object.keys(files).length ? files : null) as Parameters<typeof exportToSvg>[0]["files"],
    exportPadding: SKETCH_PADDING,
    appState: { exportBackground: false, viewBackgroundColor: "transparent" },
  });
  const [minX, minY, maxX, maxY] = getCommonBounds(scene);
  const fallback = sketchBounds(elements);
  const bounds = [minX, minY, maxX, maxY].every(Number.isFinite)
    ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
    : (fallback ?? { x: 0, y: 0, width: 0, height: 0 });
  return { svg, bounds };
}
