import { create } from "zustand";
import { localChats } from "@/features/misty/localChats";
import { applyLessonReply } from "./lessonRouter";
import type { Course, CoursePlan, Lesson, LessonPatch, LessonRoute } from "./lessonTypes";

interface LessonStore {
  accountId: string;
  lessons: Record<string, Lesson>;
  courses: Record<string, Course>;
  /** Chats started for a course's next lesson, waiting for their first reply. */
  pendingCourse: Record<string, { courseId: string; index: number }>;
  load(accountId: string): Promise<void>;
  /** Applies a finished reply to the lesson that owns it and saves what changed. */
  apply(input: {
    lessonId: string;
    runId: string;
    route?: LessonRoute;
    patch?: LessonPatch;
    course?: CoursePlan;
    agentId?: string;
  }): Lesson | undefined;
  /** Marks `conversationId` as the chat for lesson `index` of a course. */
  startCourseLesson(conversationId: string, courseId: string, index: number): void;
  /** Ends a lesson by hand, keeping what it achieved. */
  finish(lessonId: string): void;
  remove(lessonId: string): void;
}

/** A course from a reply's plan: its lessons in order, the first being this one. */
function newCourse(
  plan: CoursePlan,
  lessonId: string,
  agentId: string | undefined,
  now: string,
): Course | undefined {
  const lessons = (plan.lessons ?? [])
    .filter((lesson) => typeof lesson?.title === "string" && lesson.title.trim())
    .slice(0, 8)
    .map((lesson) => ({
      title: lesson.title!.trim().slice(0, 120),
      ...(typeof lesson.goal === "string" ? { goal: lesson.goal.slice(0, 400) } : {}),
    }));
  if (lessons.length < 2) return undefined;
  lessons[0] = { ...lessons[0], lessonId } as Course["lessons"][number];
  return {
    id: `course-${crypto.randomUUID()}`,
    agentId,
    title: (plan.title?.trim() || lessons[0].title).slice(0, 120),
    lessons,
    createdAt: now,
    updatedAt: now,
  };
}

/** Lessons and courses on this device (lessonTypes.ts), saved beside their chats in misty.db. */
export const useLessonStore = create<LessonStore>((set, get) => {
  const save = (before: Record<string, Lesson>, after: Record<string, Lesson>) => {
    const accountId = get().accountId;
    for (const lesson of Object.values(after))
      if (before[lesson.id] !== lesson)
        void localChats.saveLesson(accountId, lesson).catch(() => undefined);
  };
  const saveCourse = (course: Course) => {
    set({ courses: { ...get().courses, [course.id]: course } });
    void localChats.saveCourse(get().accountId, course).catch(() => undefined);
  };
  return {
    accountId: "",
    lessons: {},
    courses: {},
    pendingCourse: {},
    async load(accountId) {
      if (get().accountId === accountId) return;
      set({ accountId, lessons: {}, courses: {}, pendingCourse: {} });
      const [lessons, courses] = await Promise.all([
        localChats.lessons<Lesson>(accountId).catch(() => []),
        localChats.courses<Course>(accountId).catch(() => []),
      ]);
      if (get().accountId !== accountId) return;
      set({
        lessons: Object.fromEntries(lessons.map((lesson) => [lesson.id, lesson])),
        courses: Object.fromEntries(courses.map((course) => [course.id, course])),
      });
    },
    apply({ course: plan, ...input }) {
      const before = get().lessons;
      let after = applyLessonReply(before, { ...input, now: new Date().toISOString() });
      if (after === before) return before[input.lessonId];
      const now = new Date().toISOString();
      let lesson = after[input.lessonId];
      // A lesson started from a course's Next lesson button joins that course.
      const pending = get().pendingCourse[input.lessonId];
      const joining = pending && get().courses[pending.courseId];
      if (joining && !lesson.courseId) {
        const lessons = joining.lessons.map((part, index) =>
          index === pending.index ? { ...part, lessonId: lesson.id } : part,
        );
        saveCourse({ ...joining, lessons, updatedAt: now });
        lesson = { ...lesson, courseId: joining.id };
        const { [input.lessonId]: _done, ...rest } = get().pendingCourse;
        set({ pendingCourse: rest });
      } else if (plan && !lesson.courseId) {
        const course = newCourse(plan, lesson.id, input.agentId, now);
        if (course) {
          saveCourse(course);
          lesson = { ...lesson, courseId: course.id };
        }
      }
      after = { ...after, [lesson.id]: lesson };
      set({ lessons: after });
      save(before, after);
      return lesson;
    },
    startCourseLesson(conversationId, courseId, index) {
      set({ pendingCourse: { ...get().pendingCourse, [conversationId]: { courseId, index } } });
    },
    finish(lessonId) {
      const before = get().lessons;
      const lesson = before[lessonId];
      if (!lesson || lesson.status === "finished") return;
      const after = {
        ...before,
        [lessonId]: { ...lesson, status: "finished" as const, updatedAt: new Date().toISOString() },
      };
      set({ lessons: after });
      save(before, after);
    },
    remove(lessonId) {
      const { [lessonId]: removed, ...rest } = get().lessons;
      if (!removed) return;
      set({ lessons: rest });
      void localChats.deleteLesson(get().accountId, lessonId).catch(() => undefined);
    },
  };
});

/** The lesson this agent is on now, if any. */
export function activeLesson(agentId?: string): Lesson | undefined {
  return Object.values(useLessonStore.getState().lessons).find(
    (lesson) =>
      lesson.status === "active" && (!agentId || !lesson.agentId || lesson.agentId === agentId),
  );
}

/** The course lesson after this one that has no chat yet, with its place in the course. */
export function nextCourseLesson(lesson: Lesson, courses: Record<string, Course>) {
  const course = lesson.courseId ? courses[lesson.courseId] : undefined;
  if (!course) return undefined;
  const at = course.lessons.findIndex((part) => part.lessonId === lesson.id);
  const index = course.lessons.findIndex((part, i) => i > at && !part.lessonId);
  return index < 0 ? undefined : { course, index, part: course.lessons[index] };
}
