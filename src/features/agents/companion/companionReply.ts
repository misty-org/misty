import type { DisplayCapture } from "./protocol";
export function companionReply(content: string) {
  const tags = /\[POINT:([^\]\r\n]*)\]/g;
  let point: { x: number; y: number; label: string; screen?: string } | undefined;
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
  return { text: content.replace(tags, "").trim(), point };
}
export function resolvePoint(
  point: ReturnType<typeof companionReply>["point"],
  captures: DisplayCapture[],
) {
  if (!point) return undefined;
  const capture = point.screen
    ? captures.find((c) => c.screen === point.screen)
    : captures.find((c) => c.primary);
  if (!capture || capture.width <= 0 || capture.height <= 0) return undefined;
  const { display } = capture;
  return {
    x: display.x + (Math.min(capture.width, Math.max(0, point.x)) / capture.width) * display.width,
    y:
      display.y +
      (Math.min(capture.height, Math.max(0, point.y)) / capture.height) * display.height,
    displayId: display.id,
    label: point.label,
  };
}
