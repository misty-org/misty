import { screenMarkClass } from "@misty/ui";

/** The most points a trail draws; the oldest go first. */
const TRAIL_POINTS = 1_500;
/** How long a trail stays after the talk keys are let go, as it fades. */
const TRAIL_FADE_MS = 900;
const SVG = "http://www.w3.org/2000/svg";

/**
 * Paints the trail the pointer leaves while the person holds the talk keys (spatial context):
 * they circle or scribble over what they mean as they ask, and the same trail, recorded natively,
 * goes to the engine drawn on the screenshots. It fades once they let go.
 */
export function createTrailPainter(layer: HTMLDivElement) {
  let points: { x: number; y: number }[] = [];
  let svg: SVGSVGElement | undefined;
  let path: SVGPathElement | undefined;
  let fading: ReturnType<typeof setTimeout> | undefined;
  const clear = () => {
    points = [];
    svg?.remove();
    svg = undefined;
    path = undefined;
  };
  return (listening: boolean, mouse: { x: number; y: number }) => {
    if (!listening) {
      if (svg && !fading) {
        svg.toggleAttribute("data-fading", true);
        fading = setTimeout(() => {
          fading = undefined;
          clear();
        }, TRAIL_FADE_MS);
      }
      return;
    }
    if (fading) {
      clearTimeout(fading);
      fading = undefined;
      clear();
    }
    const last = points[points.length - 1];
    if (last && Math.hypot(mouse.x - last.x, mouse.y - last.y) < 2) return;
    points.push({ ...mouse });
    if (points.length > TRAIL_POINTS) points = points.slice(-TRAIL_POINTS);
    if (points.length < 2) return;
    if (!svg || !path) {
      svg = document.createElementNS(SVG, "svg");
      svg.setAttribute("class", screenMarkClass.trail);
      svg.setAttribute("width", "1");
      svg.setAttribute("height", "1");
      path = document.createElementNS(SVG, "path");
      svg.append(path);
      layer.append(svg);
    }
    path.setAttribute(
      "d",
      points.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(""),
    );
  };
}
