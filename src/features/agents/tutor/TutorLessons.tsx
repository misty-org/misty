import { useMemo } from "react";
import { useMistyStore } from "../conversations/state/useMistyStore";
import { shortAgo } from "../page/useChatStatuses";
import { Pressable } from "@/shared/ui";
import { lessonProgress } from "./lessons/lessonRouter";
import { useLessonStore } from "./lessons/lessonStore";
import type { Course, Lesson } from "./lessons/lessonTypes";

/** A course with the lessons that have chats, or a lesson taught on its own. */
type Entry =
  | { kind: "course"; course: Course; lessons: Lesson[]; updatedAt: string }
  | { kind: "lesson"; lesson: Lesson; updatedAt: string };

/** Groups lessons under their courses, newest first; a course is finished when all its parts are. */
function entriesOf(lessons: Lesson[], courses: Record<string, Course>) {
  const byCourse = new Map<string, Lesson[]>();
  const alone: Lesson[] = [];
  for (const lesson of lessons) {
    const course = lesson.courseId ? courses[lesson.courseId] : undefined;
    if (course) byCourse.set(course.id, [...(byCourse.get(course.id) ?? []), lesson]);
    else alone.push(lesson);
  }
  const entries: Entry[] = [
    ...[...byCourse].map(([id, members]) => ({
      kind: "course" as const,
      course: courses[id],
      lessons: members,
      updatedAt: members.reduce(
        (latest, item) => (item.updatedAt > latest ? item.updatedAt : latest),
        "",
      ),
    })),
    ...alone.map((lesson) => ({ kind: "lesson" as const, lesson, updatedAt: lesson.updatedAt })),
  ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const finished = (entry: Entry) =>
    entry.kind === "lesson"
      ? entry.lesson.status === "finished"
      : entry.course.lessons.every((part) =>
          entry.lessons.some((item) => item.id === part.lessonId && item.status === "finished"),
        );
  return {
    open: entries.filter((entry) => !finished(entry)),
    done: entries.filter(finished),
  };
}

/** How far along a lesson or course is, from 0 to 1. */
function share(entry: Entry): number {
  if (entry.kind === "course") {
    const total = entry.course.lessons.length;
    const done = entry.lessons.filter((lesson) => lesson.status === "finished").length;
    return total ? done / total : 0;
  }
  const { objectives, status } = entry.lesson;
  if (status === "finished") return 1;
  if (!objectives.length) return 0;
  return (
    objectives.filter((o) => o.status === "done" || o.status === "skipped").length /
    objectives.length
  );
}

function detailOf(entry: Entry): string {
  if (entry.kind === "course") {
    const done = entry.lessons.filter((lesson) => lesson.status === "finished").length;
    return `${done} of ${entry.course.lessons.length} lessons`;
  }
  const { lesson } = entry;
  const progress = lessonProgress(lesson);
  const status =
    lesson.status === "paused" ? "Paused" : lesson.status === "finished" ? "Finished" : "";
  return (
    [status, progress && `${progress} goals`].filter(Boolean).join(" · ") ||
    shortAgo(lesson.updatedAt)
  );
}

/**
 * The person's lessons: courses and lessons in progress as cards, then the finished ones as rows.
 * Opening one goes to its chat, at the lesson to pick up from.
 */
export function TutorLessons({
  onLesson,
}: {
  /** Opens a lesson's chat with the agent that teaches it. */
  onLesson(agentId: string, conversationId: string): void;
}) {
  const lessons = useLessonStore((state) => state.lessons);
  const courses = useLessonStore((state) => state.courses);
  const conversations = useMistyStore((state) => state.conversations);

  const agentOf = useMemo(() => {
    const byId = new Map(conversations.map((c) => [c.id, c.agentId ?? ""]));
    return (lesson: Lesson) => lesson.agentId ?? byId.get(lesson.id) ?? "";
  }, [conversations]);
  const { open, done } = useMemo(() => {
    const present = new Set(conversations.map((c) => c.id));
    return entriesOf(
      Object.values(lessons).filter((lesson) => present.has(lesson.id)),
      courses,
    );
  }, [lessons, courses, conversations]);

  // A course resumes at its first unfinished lesson that has a chat, else its latest.
  const openEntry = (entry: Entry) => {
    const lesson =
      entry.kind === "lesson"
        ? entry.lesson
        : (entry.lessons.find((item) => item.status !== "finished") ??
          [...entry.lessons].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]);
    if (lesson) onLesson(agentOf(lesson), lesson.id);
  };

  return (
    <>
      {open.length ? (
        <section className="tutor-section" aria-label="Lessons in progress">
          <h2>Lessons in progress</h2>
          <div className="tutor-cards">
            {open.map((entry) => (
              <Pressable
                key={entry.kind === "course" ? entry.course.id : entry.lesson.id}
                className="tutor-card"
                onClick={() => openEntry(entry)}
              >
                <span className="tutor-card-title">
                  {entry.kind === "course" ? entry.course.title : entry.lesson.title}
                </span>
                <span className="tutor-card-detail">{detailOf(entry)}</span>
                <span className="tutor-meter" aria-hidden>
                  <span style={{ width: `${Math.round(share(entry) * 100)}%` }} />
                </span>
              </Pressable>
            ))}
          </div>
        </section>
      ) : null}

      {done.length ? (
        <section className="tutor-section" aria-label="Finished lessons">
          <h2>Finished lessons</h2>
          <div className="tutor-rows">
            {done.map((entry) => (
              <Pressable
                key={entry.kind === "course" ? entry.course.id : entry.lesson.id}
                className="tutor-row"
                onClick={() => openEntry(entry)}
              >
                <span className="truncate">
                  {entry.kind === "course" ? entry.course.title : entry.lesson.title}
                </span>
                <span className="tutor-card-detail">{shortAgo(entry.updatedAt)}</span>
              </Pressable>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
