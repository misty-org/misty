import { useState } from "react";
import { Button, Text } from "@misty/ui";
import { useMistyStore } from "../../conversations/state/use_misty_store";
import { useCollaborationStore } from "../../plans/store";
import { StatusRow, StatusTable, type StatusState } from "../../progress/StatusTable";
import { lessonProgress } from "./lesson_router";
import { nextCourseLesson, useLessonStore } from "./lesson_store";
import type { LessonObjective } from "./lesson_types";

const rowState = (objective: LessonObjective, current: boolean): [StatusState, string] => {
  if (objective.status === "done") return ["done", "Done"];
  if (objective.status === "skipped") return ["skipped", "Skipped"];
  if (current || objective.status === "in_progress") return ["waiting", "Your turn"];
  return ["next", "Next"];
};

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
      [],
      { conversationId, context: [] },
      { executionMode: "user", collaborationMode: "teach" },
    );
}

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
          ? `Lesson finished with ${progress} goals`
          : `${lesson.goal || lesson.title}, ${progress} goals${lesson.status === "paused" ? ", paused" : ""}`
      }
      actions={
        next ? (
          <>
            <Button disabled={starting} onClick={() => void start()}>
              Next lesson: {next.part.title}
            </Button>
            {notice && (
              <Text size="meta" bare tone="muted" role="status">
                {notice}
              </Text>
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
