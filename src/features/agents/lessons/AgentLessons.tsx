import { useMemo, useState } from "react";
import { useMistyStore } from "@/features/misty/useMistyStore";
import { Button, TreeBranch } from "@/shared/ui";
import { lessonProgress } from "./lessonRouter";
import { useLessonStore } from "./lessonStore";
import type { Course, Lesson } from "./lessonTypes";

const statusWord: Record<Lesson["status"], string> = {
  active: "In progress",
  paused: "Paused",
  finished: "Finished",
};

/** The lessons whose chats are on this device, for one agent: the one in progress, then paused, then finished. */
export function useAgentLessons(agentId: string) {
  const lessons = useLessonStore((s) => s.lessons);
  const conversations = useMistyStore((s) => s.conversations);
  return useMemo(() => {
    const present = new Set(conversations.map((c) => c.id));
    const order = { active: 0, paused: 1, finished: 2 } as const;
    return Object.values(lessons)
      .filter((lesson) => present.has(lesson.id) && (!lesson.agentId || lesson.agentId === agentId))
      .sort(
        (a, b) =>
          order[a.status] - order[b.status] || Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
      );
  }, [lessons, conversations, agentId]);
}

/** One entry of the section: a lesson on its own, or a course with its lessons under it. */
type Entry =
  { kind: "lesson"; lesson: Lesson } | { kind: "course"; course: Course; lessons: Lesson[] };

/** Groups a course's lessons under it, in the course's order, where its first lesson would sit. */
function entriesOf(lessons: Lesson[], courses: Record<string, Course>): Entry[] {
  const out: Entry[] = [];
  const placed = new Set<string>();
  for (const lesson of lessons) {
    const course = lesson.courseId ? courses[lesson.courseId] : undefined;
    if (!course) {
      out.push({ kind: "lesson", lesson });
      continue;
    }
    if (placed.has(course.id)) continue;
    placed.add(course.id);
    const byId = new Map(lessons.map((item) => [item.id, item]));
    const members = course.lessons.flatMap((part) =>
      part.lessonId && byId.get(part.lessonId) ? [byId.get(part.lessonId)!] : [],
    );
    out.push({ kind: "course", course, lessons: members });
  }
  return out;
}

/**
 * The Lessons section of an agent's sidebar (Teach mode): a plain section header over
 * its lessons, which hang off it with the shared tree branch. A course is a row with
 * its lessons hanging off it in turn. Status and progress are text.
 */
export function AgentLessons({
  lessons,
  activeId,
  disabled,
  onConversation,
}: {
  lessons: Lesson[];
  activeId?: string;
  disabled: boolean;
  onConversation(id: string): void;
}) {
  const courses = useLessonStore((s) => s.courses);
  const [showFinished, setShowFinished] = useState(false);
  if (!lessons.length) return null;
  const open = entriesOf(
    lessons.filter((lesson) => lesson.status !== "finished" || lesson.courseId),
    courses,
  );
  const finished = lessons.filter((lesson) => lesson.status === "finished" && !lesson.courseId);
  const shown: Entry[] = showFinished
    ? [...open, ...finished.map((lesson) => ({ kind: "lesson" as const, lesson }))]
    : open;
  const lessonRow = (lesson: Lesson, last: boolean, depth: number) => {
    const progress = lessonProgress(lesson);
    const detail = [statusWord[lesson.status], progress].filter(Boolean).join(" · ");
    return (
      <div
        key={lesson.id}
        className="agent-studio-recent-row agent-lesson-row"
        data-current={activeId === lesson.id || undefined}
        data-depth={depth || undefined}
      >
        <TreeBranch className={depth ? "left-6 w-2.5" : "left-3 w-2.5"} last={last} />
        <Button
          data-agent-navigation-control
          variant="ghost"
          justify="start"
          disabled={disabled}
          title={`${lesson.title}, ${detail}`}
          aria-current={activeId === lesson.id ? "page" : undefined}
          onClick={() => onConversation(lesson.id)}
        >
          <span className="agent-studio-recent-title">{lesson.title}</span>
          <span className="agent-lesson-detail">{detail}</span>
        </Button>
      </div>
    );
  };
  const courseRows = (course: Course, members: Lesson[], last: boolean) => {
    const done = members.filter((lesson) => lesson.status === "finished").length;
    const resume =
      members.find((lesson) => lesson.status !== "finished") ?? members[members.length - 1];
    return (
      <div key={course.id} role="group" aria-label={course.title}>
        <div className="agent-studio-recent-row agent-lesson-row">
          <TreeBranch className="left-3 w-2.5" last={last && !members.length} />
          <Button
            variant="ghost"
            justify="start"
            disabled={disabled || !resume}
            title={`${course.title}, ${done} of ${course.lessons.length} lessons`}
            onClick={() => resume && onConversation(resume.id)}
          >
            <span className="agent-studio-recent-title">{course.title}</span>
            <span className="agent-lesson-detail">
              {done} of {course.lessons.length} lessons
            </span>
          </Button>
        </div>
        {members.map((lesson, index) => lessonRow(lesson, index === members.length - 1, 1))}
      </div>
    );
  };
  return (
    <div className="agent-studio-recents-group" role="group" aria-label="Lessons">
      <div className="agent-studio-recents-heading">
        <h2>Lessons</h2>
      </div>
      {shown.map((entry, index) => {
        const last = index === shown.length - 1 && !finished.length;
        return entry.kind === "course"
          ? courseRows(entry.course, entry.lessons, last)
          : lessonRow(entry.lesson, last, 0);
      })}
      {finished.length > 0 && (
        <div className="agent-studio-recent-row agent-lesson-row">
          <TreeBranch className="left-3 w-2.5" last />
          <Button
            variant="ghost"
            justify="start"
            aria-expanded={showFinished}
            onClick={() => setShowFinished((value) => !value)}
          >
            <span className="agent-lesson-detail">
              {showFinished ? "Hide finished" : `Finished · ${finished.length}`}
            </span>
          </Button>
        </div>
      )}
    </div>
  );
}
