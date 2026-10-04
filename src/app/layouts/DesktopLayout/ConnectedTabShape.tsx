import { useId, useLayoutEffect, useRef, useState } from "react";

/** Corner and shoulder radius, from the strip's `--tab-shoulder`. */
export function connectedTabRadius(element: Element) {
  return parseFloat(getComputedStyle(element).getPropertyValue("--tab-shoulder")) || 14;
}

/**
 * A horizontal tab's fill and outline as one SVG path, so the upper corners,
 * sides and shoulders share a single stroke with no seams between separately
 * painted pieces. The bottom edge sits on the pane seam row and covers it
 * between the shoulders; bottom strips mirror the shape. Only the active tab
 * shows it at rest; the drag preview reveals its copy for any lifted tab.
 */
export function ConnectedTabShape() {
  const ref = useRef<SVGSVGElement>(null);
  const gradientId = `misty-tab-fill-${useId().replace(/[^\w-]/g, "")}`;
  const [size, setSize] = useState<{ width: number; height: number; radius: number } | null>(null);

  useLayoutEffect(() => {
    const tab = ref.current?.parentElement;
    if (!tab) return;
    const radius = connectedTabRadius(tab);
    // Layout sizes, not client rects: drag previews transform the tab.
    const measure = (width: number, height: number) =>
      setSize((current) =>
        current?.width === width && current.height === height ? current : { width, height, radius },
      );
    measure(tab.offsetWidth, tab.offsetHeight);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const box = entry?.borderBoxSize?.[0];
      if (box) measure(box.inlineSize, box.blockSize);
      else measure(tab.offsetWidth, tab.offsetHeight);
    });
    observer.observe(tab);
    return () => observer.disconnect();
  }, []);

  const outline = size ? outlinePath(size.width + size.radius * 2, size.height, size.radius) : "";
  return (
    <svg ref={ref} aria-hidden="true" className="misty-workspace-tab-shape" focusable="false">
      {size && (
        <>
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" style={{ stopColor: "var(--workspace-tab-surface-top)" }} />
              <stop offset="1" style={{ stopColor: "var(--workspace-tab-surface)" }} />
            </linearGradient>
          </defs>
          <path d={`${outline} V ${size.height} H 0 Z`} fill={`url(#${gradientId})`} />
          <path d={outline} className="misty-workspace-tab-shape-outline" />
        </>
      )}
    </svg>
  );
}

/**
 * Outline centered on whole device-independent pixels: the shoulders end on
 * the pane seam row (height - 1 to height) and the sides on the first and
 * last pixel columns of the tab body.
 */
function outlinePath(width: number, height: number, r: number) {
  const seam = height - 0.5;
  const shoulder = r + 0.5;
  const top = 0.5;
  const corner = r - 0.5;
  const left = r + 0.5;
  const right = width - r - 0.5;
  return [
    `M 0 ${seam}`,
    `A ${shoulder} ${shoulder} 0 0 0 ${left} ${seam - shoulder}`,
    `V ${top + corner}`,
    `A ${corner} ${corner} 0 0 1 ${left + corner} ${top}`,
    `H ${right - corner}`,
    `A ${corner} ${corner} 0 0 1 ${right} ${top + corner}`,
    `V ${seam - shoulder}`,
    `A ${shoulder} ${shoulder} 0 0 0 ${width} ${seam}`,
  ].join(" ");
}
