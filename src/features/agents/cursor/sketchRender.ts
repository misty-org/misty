import { sketchBounds, sketchSkeleton, type SketchElement } from "./companionSketch";

/** Space around a drawing inside its SVG, in drawing units. */
export const SKETCH_PADDING = 16;

/**
 * Renders a sketch to an SVG with Excalidraw's hand-drawn style. Excalidraw loads on
 * the first drawing only. `stroke` is near-black on the whiteboard and white for marks
 * over the screen, where a shadow keeps it readable.
 */
export async function renderSketch(
  elements: SketchElement[],
  stroke: string,
): Promise<
  | { svg: SVGSVGElement; bounds: { x: number; y: number; width: number; height: number } }
  | undefined
> {
  if (!elements.length) return undefined;
  const { convertToExcalidrawElements, exportToSvg, getCommonBounds } =
    await import("@excalidraw/excalidraw");
  const scene = convertToExcalidrawElements(
    sketchSkeleton(elements, stroke) as Parameters<typeof convertToExcalidrawElements>[0],
    { regenerateIds: false },
  );
  if (!scene.length) return undefined;
  const svg = await exportToSvg({
    elements: scene,
    files: null,
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
