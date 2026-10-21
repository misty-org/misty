import type {
  Course,
  CoursePayload,
  Lesson,
  LessonObjective,
  LessonPatch,
  LessonPayload,
  LessonRoute,
  LessonSummaryPayload,
} from "./lessonTypes";

/** Paused lessons older than this are not offered for "resume"; they can still be opened. */
export const RESUME_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const objectiveStatuses = new Set(["pending", "in_progress", "done", "skipped"]);

/** "3 of 5", counting done and skipped objectives. */
export function lessonProgress(lesson: Pick<Lesson, "objectives">): string {
  const total = lesson.objectives.length;
  if (!total) return "";
  const settled = lesson.objectives.filter((o) => o.status === "done" || o.status === "skipped");
  return `${settled.length} of ${total}`;
}

/** Where a reply's turn belongs: here, a new lesson, or a paused lesson it resumes. */
export function routeTarget(
  lessons: Record<string, Lesson>,
  conversationId: string,
  route: LessonRoute | undefined,
  /** The chat has turns before this one. */
  earlierTurns = false,
): { kind: "here" } | { kind: "new"; title: string } | { kind: "resume"; id: string } {
  const here = lessons[conversationId];
  if (route?.kind === "resume" && route.id !== conversationId && lessons[route.id])
    return { kind: "resume", id: route.id };
  // A finished lesson, or a chat that was something else first, never takes a new lesson.
  const occupied = here ? here.appliedRuns.length > 0 || here.status === "finished" : earlierTurns;
  if (occupied && (route?.kind === "new" || here?.status === "finished" || !here))
    return { kind: "new", title: route?.kind === "new" ? route.title : "Lesson" };
  return { kind: "here" };
}

function cleanObjectives(objectives: LessonObjective[] | undefined): LessonObjective[] | undefined {
  if (!Array.isArray(objectives)) return undefined;
  return objectives
    .filter((o) => o && typeof o.id === "string" && typeof o.title === "string")
    .slice(0, 8)
    .map((o) => ({
      id: o.id.slice(0, 120),
      title: o.title.slice(0, 200),
      ...(typeof o.contract === "string" ? { contract: o.contract.slice(0, 400) } : {}),
      status: objectiveStatuses.has(o.status) ? o.status : "pending",
    }));
}

/**
 * Applies a reply to the lesson that owns it, after any move. That lesson becomes
 * the active one and every other active lesson pauses: one lesson is active at a time.
 */
export function applyLessonReply(
  lessons: Record<string, Lesson>,
  input: {
    lessonId: string;
    runId: string;
    route?: LessonRoute;
    patch?: LessonPatch;
    agentId?: string;
    now: string;
  },
): Record<string, Lesson> {
  const existing = lessons[input.lessonId];
  if (existing?.appliedRuns.includes(input.runId)) return lessons;
  const previous = Object.values(lessons).find(
    (lesson) => lesson.status === "active" && lesson.id !== input.lessonId,
  );
  const patch = input.patch ?? {};
  const title =
    patch.title?.trim() ||
    existing?.title ||
    (input.route?.kind === "new" ? input.route.title : "") ||
    "Lesson";
  const base: Lesson = existing ?? {
    id: input.lessonId,
    agentId: input.agentId,
    title,
    objectives: [],
    answerPolicy: "hints",
    hintLevel: "nudge",
    status: "active",
    appliedRuns: [],
    createdAt: input.now,
    updatedAt: input.now,
  };
  const finished = patch.status === "finished";
  const next: Lesson = {
    ...base,
    title: title.slice(0, 120),
    goal: patch.goal?.slice(0, 400) ?? base.goal,
    objectives: cleanObjectives(patch.objectives) ?? base.objectives,
    current: patch.current ?? base.current,
    answerPolicy:
      patch.answer_policy === "code" || patch.answer_policy === "hints"
        ? patch.answer_policy
        : base.answerPolicy,
    hintLevel:
      patch.hint_level === "nudge" || patch.hint_level === "hint" || patch.hint_level === "line"
        ? patch.hint_level
        : base.hintLevel,
    notes: patch.notes?.slice(0, 1200) ?? base.notes,
    status: finished ? "finished" : "active",
    summary: finished ? (patch.summary?.slice(0, 2000) ?? base.summary) : base.summary,
    previousId: previous && previous.id !== base.previousId ? previous.id : base.previousId,
    appliedRuns: [...base.appliedRuns, input.runId].slice(-20),
    updatedAt: input.now,
  };
  const out: Record<string, Lesson> = { ...lessons, [next.id]: next };
  if (previous) out[previous.id] = { ...previous, status: "paused", updatedAt: input.now };
  return out;
}

/** The current lesson and resumable paused ones, as a Teach turn in `conversationId` sends them. */
export function lessonTurnPayload(
  lessons: Record<string, Lesson>,
  conversationId: string,
  now = Date.now(),
  courses: Record<string, Course> = {},
): { lesson?: LessonPayload; lessonIndex: LessonSummaryPayload[] } {
  const lesson = lessons[conversationId];
  const lessonIndex = Object.values(lessons)
    .filter(
      (item) =>
        item.id !== conversationId &&
        item.status === "paused" &&
        now - Date.parse(item.updatedAt) < RESUME_WINDOW_MS,
    )
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 20)
    .map((item) => ({
      id: item.id,
      title: item.title,
      ...(item.goal ? { goal: item.goal } : {}),
      progress: lessonProgress(item),
    }));
  if (!lesson || lesson.status === "finished") return { lessonIndex };
  return {
    lesson: {
      id: lesson.id,
      title: lesson.title,
      goal: lesson.goal,
      objectives: lesson.objectives,
      current: lesson.current,
      answer_policy: lesson.answerPolicy,
      hint_level: lesson.hintLevel,
      notes: lesson.notes,
      status: lesson.status,
      ...(lesson.courseId && courses[lesson.courseId]
        ? { course: coursePayload(lesson, lessons, courses[lesson.courseId]) }
        : {}),
    },
    lessonIndex,
  };
}

/** A lesson's course as its turn sends it: each lesson done, current or next. */
function coursePayload(
  lesson: Lesson,
  lessons: Record<string, Lesson>,
  course: Course,
): CoursePayload {
  return {
    title: course.title,
    lessons: course.lessons.map((part) => ({
      title: part.title,
      ...(part.goal ? { goal: part.goal } : {}),
      status:
        part.lessonId === lesson.id
          ? ("current" as const)
          : part.lessonId && lessons[part.lessonId]?.status === "finished"
            ? ("done" as const)
            : ("next" as const),
    })),
  };
}
