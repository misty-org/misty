/** Solid-color approximation of the surface exposed by a late resize frame.
 * Sample inside the right edge, where left-edge resizing exposes old content.
 * Native browser pages report their solid background onto their host element.
 * Background images remain a solid-color approximation.
 */
export function windowSurfaceBackground(fallback: string): string {
  if (typeof document.elementsFromPoint !== "function") return fallback;
  const x = Math.max(0, window.innerWidth - 24);
  const y = Math.max(0, window.innerHeight / 2);
  const elements = document.elementsFromPoint(x, y);
  let color = parseRgb(fallback);
  if (!color) return fallback;
  // Paint bottom to top so translucent panels blend with their backing surface.
  for (const element of elements.reverse()) {
    const nativeColor = element.hasAttribute("data-browser-page-host")
      ? element.getAttribute("data-misty-browser-background")
      : null;
    const foreground = parseRgb(nativeColor ?? getComputedStyle(element).backgroundColor);
    if (!foreground) continue;
    const alpha = foreground[3];
    color = [
      foreground[0] * alpha + color[0] * (1 - alpha),
      foreground[1] * alpha + color[1] * (1 - alpha),
      foreground[2] * alpha + color[2] * (1 - alpha),
      1,
    ];
  }
  return `#${color
    .slice(0, 3)
    .map((value) => Math.round(value).toString(16).padStart(2, "0"))
    .join("")}`;
}

function parseRgb(value: string): [number, number, number, number] | null {
  if (/^#[\da-f]{6}$/i.test(value)) {
    return [1, 3, 5].map((offset) => parseInt(value.slice(offset, offset + 2), 16)).concat(1) as [
      number,
      number,
      number,
      number,
    ];
  }
  const match = value.match(
    /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/,
  );
  if (!match) return null;
  const channels = match.slice(1, 4).map(Number);
  const alpha = match[4] === undefined ? 1 : Number(match[4]);
  if (channels.some((channel) => channel > 255) || alpha > 1) return null;
  return [...channels, alpha] as [number, number, number, number];
}
