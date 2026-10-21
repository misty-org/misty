import { useState } from "react";
import { Button } from "@/shared/ui";
import { useMistyStore } from "@/features/misty/useMistyStore";
import { useCollaborationStore } from "../collaboration/store";
import { StatusRow, StatusTable, type StatusState } from "../progress/StatusTable";
import { lessonProgress } from "./lessonRouter";
import { nextCourseLesson, useLessonStore } from "./lessonStore";
import type { LessonObjective } from "./lessonTypes";

const rowState = (objective: LessonObjective, current: boolean): [StatusState, string] => {
  if (objective.status === "done") return ["done", "Done"];
  if (objective.status === "skipped") return ["skipped", "Skipped"];
  // The step in progress waits on the person, not on Misty.
  if (current || objective.status === "in_progress") return ["waiting", "Your turn"];
  return ["next", "Next"];
};

/**
 * Starts a course's next lesson in a new Teach chat: the tutor plans it from its
 * title and goal, the same way a new lesson starts at the cursor.
 */
async function startNextLesson(courseId: string, index: number, title: string, goal?: string) {
  const misty = useMistyStore.getState();
  const conversationId = await misty.newConversation(undefined, misty.selectedAgentId);
  await useCollaborationStore.getState().setMode(conversationId, "teach");
  useLessonStore.getState().startCourseLesson(conversationId, courseId, index);
  await useMistyStore
    .getState()
    .submitAnswer(
      `Start the next lesson of the course: ${title}.${goal ? ` ${goal}` : ""}`,
      [],
      undefined,
      "workspace",
      [],
      { conversationId, context: [] },
      { executionMode: "user", collaborationMode: "teach" },
    );
}

/**
 * A lesson chat's objectives above its transcript (Teach mode): the shared status
 * table, one row per objective, updated by each reply. A finished lesson shows what
 * was achieved, and in a course, the button that starts the next lesson.
 */
export function LessonObjectives({ conversationId }: { conversationId: string }) {
  const lesson = useLessonStore((s) => s.lessons[conversationId]);
  const courses = useLessonStore((s) => s.courses);
  const [starting, setStarting] = useState(false);
  const [notice, setNotice] = useState("");
  if (!lesson || !lesson.objectives.length) return null;
  const finished = lesson.status === "finished";
  const progress = lessonProgress(lesson);
  const next = finished ? nextCourseLesson(lesson, courses) : undefined;
  const start = async () => {
    if (!next) return;
    setStarting(true);
    setNotice("");
    try {
      await startNextLesson(next.course.id, next.index, next.part.title, next.part.goal);
    } catch {
      setNotice("Misty couldn't start the next lesson. Try again.");
    } finally {
      setStarting(false);
    }
  };
  return (
    <StatusTable
      label={`Lesson: ${lesson.title}`}
      head={
        finished
          ? `Lesson finished · ${progress}`
          : `${lesson.goal || lesson.title} · ${progress}${lesson.status === "paused" ? " · Paused" : ""}`
      }
      actions={
        next ? (
          <>
            <Button size="sm" disabled={starting} onClick={() => void start()}>
              Next lesson: {next.part.title}
            </Button>
            {notice && (
              <span role="status" className="text-xs text-cream-muted">
                {notice}
              </span>
            )}
          </>
        ) : undefined
      }
    >
      {lesson.objectives.map((objective) => {
        const [state, verb] = rowState(objective, !finished && lesson.current === objective.id);
        return (
          <StatusRow
            key={objective.id}
            state={finished && state === "waiting" ? "stopped" : state}
            verb={finished && state === "waiting" ? "Not reached" : verb}
          >
            {objective.title}
          </StatusRow>
        );
      })}
      {finished && lesson.summary ? (
        <StatusRow state="plain" sub={lesson.summary}>
          What you achieved
        </StatusRow>
      ) : null}
    </StatusTable>
  );
}
