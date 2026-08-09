export type ViewportGeometry = {
  width: number;
  height: number;
  topInset?: number;
  gutter?: number;
};

export type FloatingPanelGeometry = {
  left: number;
  top: number;
  width: number;
  height: number;
  maxHeight: number;
};

export function fitFloatingPanel(
  desiredLeft: number,
  desiredTop: number,
  requestedWidth: number,
  requestedHeight: number,
  viewport: ViewportGeometry,
): FloatingPanelGeometry {
  const gutter = viewport.gutter ?? 8;
  const topBoundary = (viewport.topInset ?? 0) + gutter;
  const rightBoundary = Math.max(gutter, viewport.width - gutter);
  const bottomBoundary = Math.max(topBoundary, viewport.height - gutter);
  const width = Math.min(requestedWidth, Math.max(0, rightBoundary - gutter));
  const maxHeight = Math.max(0, bottomBoundary - topBoundary);
  const height = Math.min(requestedHeight, maxHeight);

  return {
    left: clamp(desiredLeft, gutter, rightBoundary - width),
    top: clamp(desiredTop, topBoundary, bottomBoundary - height),
    width,
    height,
    maxHeight,
  };
}

export function adjacentPanelLeft(options: {
  anchorLeft: number;
  anchorWidth: number;
  panelWidth: number;
  viewportWidth: number;
  gap?: number;
  gutter?: number;
}): number {
  const gap = options.gap ?? 8;
  const gutter = options.gutter ?? 8;
  const right = options.anchorLeft + options.anchorWidth + gap;
  const left = options.anchorLeft - options.panelWidth - gap;

  if (right + options.panelWidth <= options.viewportWidth - gutter) return right;
  if (left >= gutter) return left;
  return clamp(
    right,
    gutter,
    Math.max(gutter, options.viewportWidth - options.panelWidth - gutter),
  );
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (maximum <= minimum) return minimum;
  return Math.min(Math.max(minimum, value), maximum);
}
