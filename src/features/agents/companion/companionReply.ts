import type { DisplayCapture } from "./protocol";
/** A walkthrough step: this answer shows `step` of about `total`. */
export interface CompanionGuide {
  step: number;
  total: number;
}
const guideTags = /\[GUIDE:(\d{1,2})\/(\d{1,2})\]/g;
export function companionReply(content: string) {
  const tags = /\[POINT:([^\]\r\n]*)\]/g;
  let point: { x: number; y: number; label: string; screen?: string } | undefined;
  let guide: CompanionGuide | undefined;
  for (const match of content.matchAll(guideTags)) {
    const step = Number(match[1]),
      total = Number(match[2]);
    guide = step >= 1 && total >= step ? { step, total } : undefined;
  }
  for (const match of content.matchAll(tags)) {
    if (match[1].trim().toLowerCase() === "none") {
      point = undefined;
      continue;
    }
    const parsed = /^(\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?):([^\r\n]{1,120}?)(?::(screen\d+))?$/.exec(
      match[1],
    );
    if (parsed)
      point = { x: Number(parsed[1]), y: Number(parsed[2]), label: parsed[3], screen: parsed[4] };
  }
  return {
    text: content.replace(tags, "").replace(guideTags, "").trim(),
    point,
    guide,
  };
}
export function resolvePoint(
  point: ReturnType<typeof companionReply>["point"],
  captures: DisplayCapture[],
) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return undefined;
  const capture = point.screen
    ? captures.find((c) => c.screen === point.screen)
    : captures.find((c) => c.primary);
  if (!capture || capture.width <= 0 || capture.height <= 0) return undefined;
  const { display } = capture;
  if (
    ![capture.width, capture.height, display.x, display.y, display.width, display.height].every(
      Number.isFinite,
    ) ||
    display.width <= 0 ||
    display.height <= 0
  )
    return undefined;
  return {
    x: display.x + (Math.min(capture.width, Math.max(0, point.x)) / capture.width) * display.width,
    y:
      display.y +
      (Math.min(capture.height, Math.max(0, point.y)) / capture.height) * display.height,
    displayId: display.id,
    label: point.label,
  };
}
