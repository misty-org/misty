import type { CoursePlan, LessonPatch, LessonRoute } from "../lessons/lessonTypes";
import type { DisplayCapture } from "./protocol";
/** A walkthrough step: this answer shows `step` of about `total`. */
interface CompanionGuide {
  step: number;
  total: number;
}
const guideTags = /\[GUIDE:(\d{1,2})\/(\d{1,2})\]/g;
// Teach mode's tags (server companion_teach_mode.txt). LESSON is one line of JSON,
// which may hold brackets, so it runs to the end of its line.
const routeTags = /\[ROUTE:([^\]\r\n]*)\]/g;
const focusTags = /\[FOCUS:([^\]\r\n]*)\]/g;
const lessonTags = /\[LESSON:([^\r\n]*)\]/g;
const courseTags = /\[COURSE:([^\r\n]*)\]/g;
// A tag still streaming in, not yet closed, stays hidden until it completes.
const openTag = /\[[A-Z]{0,6}(?::[^\]\r\n]*)?$|\[(?:LESSON|COURSE):[^\r\n]*$/;

/** A region to look at, in one screenshot's pixels: [FOCUS:x1,y1,x2,y2:screenN]. */
interface CompanionFocus {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  screen?: string;
}

function parseRoute(value: string): LessonRoute | undefined {
  const [kind, ...rest] = value.split(":");
  const arg = rest.join(":").trim();
  if (kind === "continue") return { kind: "continue" };
  if (kind === "resume" && arg) return { kind: "resume", id: arg.slice(0, 120) };
  if (kind === "new") return { kind: "new", title: (arg || "Lesson").slice(0, 120) };
  return undefined;
}

function parseLesson(value: string): LessonPatch | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as LessonPatch)
      : undefined;
  } catch {
    return undefined;
  }
}

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
    const parsed =
      /^(\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?):([^\r\n]{1,120}?)(?::(screen\d+|window1))?$/.exec(
        match[1],
      );
    if (parsed)
      point = { x: Number(parsed[1]), y: Number(parsed[2]), label: parsed[3], screen: parsed[4] };
  }
  let route: LessonRoute | undefined;
  for (const match of content.matchAll(routeTags)) route ??= parseRoute(match[1].trim());
  const focus: CompanionFocus[] = [];
  for (const match of content.matchAll(focusTags)) {
    const parsed = /^(\d+),\s*(\d+),\s*(\d+),\s*(\d+)(?::(screen\d+|focus\d+|window\d+))?$/.exec(
      match[1].trim(),
    );
    if (!parsed || focus.length >= 2) continue;
    const [x1, y1, x2, y2] = parsed.slice(1, 5).map(Number);
    if (x2 > x1 && y2 > y1) focus.push({ x1, y1, x2, y2, screen: parsed[5] });
  }
  let course: CoursePlan | undefined;
  for (const match of content.matchAll(courseTags)) {
    const plan = parseLesson(match[1]) as CoursePlan | undefined;
    if (plan && Array.isArray(plan.lessons)) course = plan;
  }
  let lesson: LessonPatch | undefined;
  for (const match of content.matchAll(lessonTags)) {
    const patch = parseLesson(match[1]);
    if (patch) lesson = { ...lesson, ...patch };
  }
  const text = content
    .replace(lessonTags, "")
    .replace(courseTags, "")
    .replace(routeTags, "")
    .replace(focusTags, "")
    .replace(tags, "")
    .replace(guideTags, "")
    .replace(openTag, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text, point, guide, route, focus: focus.length ? focus : undefined, lesson, course };
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

/** A focus region in global coordinates, through its screenshot's display frame. */
export function resolveFocus(focus: CompanionFocus, captures: DisplayCapture[]) {
  const capture = focus.screen
    ? captures.find((c) => c.screen === focus.screen)
    : captures.find((c) => c.primary);
  if (!capture || capture.width <= 0 || capture.height <= 0) return undefined;
  const { display } = capture;
  const sx = display.width / capture.width;
  const sy = display.height / capture.height;
  const clampX = (x: number) => Math.min(capture.width, Math.max(0, x));
  const clampY = (y: number) => Math.min(capture.height, Math.max(0, y));
  const x = display.x + clampX(focus.x1) * sx;
  const y = display.y + clampY(focus.y1) * sy;
  const width = (clampX(focus.x2) - clampX(focus.x1)) * sx;
  const height = (clampY(focus.y2) - clampY(focus.y1)) * sy;
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return undefined;
  return { displayId: display.id, frame: { x, y, width, height } };
}
