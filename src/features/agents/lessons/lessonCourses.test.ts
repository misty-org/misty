import { beforeEach, describe, expect, it } from "vitest";
import { companionReply } from "../companion/companionReply";
import { lessonTurnPayload } from "./lessonRouter";
import { nextCourseLesson, useLessonStore } from "./lessonStore";

const plan =
  "[ROUTE:new:components]\nlet's start with " +
  'components.\n[COURSE:{"title":"react","lessons":[{"title":"components","goal":"build ' +
  'one"},{"title":"state"},{"title":"effects"}]}]';

describe("courses", () => {
  beforeEach(() =>
    useLessonStore.setState({ accountId: "a", lessons: {}, courses: {}, pendingCourse: {} }),
  );

  it("reads a course plan and never shows it", () => {
    const reply = companionReply(plan);
    expect(reply.text).toBe("let's start with components.");
    expect(reply.course?.lessons?.map((l) => l.title)).toEqual(["components", "state", "effects"]);
  });

  it("starts a course with its first lesson, then joins the next lesson to it", () => {
    const store = useLessonStore.getState();
    const first = store.apply({
      lessonId: "chat-1",
      runId: "r1",
      route: { kind: "new", title: "components" },
      course: companionReply(plan).course,
    });
    const { courses } = useLessonStore.getState();
    const course = courses[first!.courseId!];
    expect(course.title).toBe("react");
    expect(course.lessons[0].lessonId).toBe("chat-1");
    const finished = store.apply({
      lessonId: "chat-1",
      runId: "r2",
      patch: { status: "finished", summary: "built one" },
    })!;
    const next = nextCourseLesson(finished, useLessonStore.getState().courses);
    expect(next).toMatchObject({ index: 1, part: { title: "state" } });

    store.startCourseLesson("chat-2", course.id, 1);
    const second = useLessonStore
      .getState()
      .apply({ lessonId: "chat-2", runId: "r3", route: { kind: "new", title: "state" } })!;
    expect(second.courseId).toBe(course.id);
    expect(useLessonStore.getState().courses[course.id].lessons[1].lessonId).toBe("chat-2");

    const payload = lessonTurnPayload(
      useLessonStore.getState().lessons,
      "chat-2",
      Date.now(),
      useLessonStore.getState().courses,
    );
    expect(payload.lesson?.course?.lessons.map((l) => l.status)).toEqual([
      "done",
      "current",
      "next",
    ]);
  });

  it("ignores a plan too small to be a course", () => {
    const lesson = useLessonStore
      .getState()
      .apply({ lessonId: "c", runId: "r", course: { title: "x", lessons: [{ title: "only" }] } });
    expect(lesson?.courseId).toBeUndefined();
  });
});
