export const companionSizeDefault = 100;
export const companionSizeMin = 50;
export const companionSizeMax = 200;
export const companionSizeStep = 25;

export function normalizeCompanionSize(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return companionSizeDefault;
  return Math.min(
    companionSizeMax,
    Math.max(companionSizeMin, Math.round(value / companionSizeStep) * companionSizeStep),
  );
}

/** Keep the buddy beside the cursor and fully visible at display edges. */
export function companionFollowPoint(
  mouse: { x: number; y: number },
  width: number,
  height: number,
  size: number,
) {
  const radius = (16 * normalizeCompanionSize(size)) / 100;
  const margin = radius + 4;
  return {
    x: Math.max(margin, Math.min(width - margin, mouse.x + radius + 19)),
    y: Math.max(margin, Math.min(height - margin, mouse.y + radius + 9)),
  };
}
