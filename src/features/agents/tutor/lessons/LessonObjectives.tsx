import { useState } from "react";
import { Button, Text, TurnTasks, type TurnTask } from "@misty/ui";
import { useMistyStore } from "../../conversations/state/use_misty_store";
import { useCollaborationStore } from "../../plans/store";
import { lessonProgress } from "./lesson_router";
import { nextCourseLesson, useLessonStore } from "./lesson_store";
import type { LessonObjective } from "./lesson_types";

function taskOf(objective: LessonObjective, current: boolean, finished: boolean): TurnTask {
  const task = { id: objective.id, title: objective.title };
  if (objective.status === "done") return { ...task, state: "done" };
  if (objective.status === "skipped") return { ...task, state: "skipped" };
  if (current || objective.status === "in_progress")
    return finished
      ? { ...task, state: "pending", note: "Not reached" }
      : { ...task, state: "waiting", note: "Your turn" };
  return { ...task, state: "pending" };
}

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
    <TurnTasks
      label={`Lesson: ${lesson.title}`}
      head={
        finished
          ? `Lesson finished with ${progress} goals`
          : `${lesson.goal || lesson.title}, ${progress} goals${lesson.status === "paused" ? ", paused" : ""}`
      }
      tasks={lesson.objectives.map((objective) =>
        taskOf(objective, !finished && lesson.current === objective.id, finished),
      )}
      foot={
        (finished && lesson.summary) || next ? (
          <>
            {finished && lesson.summary ? (
              <Text as="p" bare size="meta" tone="muted" wrap>
                {lesson.summary}
              </Text>
            ) : null}
            {next ? (
              <Button disabled={starting} onClick={() => void start()}>
                Next lesson: {next.part.title}
              </Button>
            ) : null}
            {notice ? (
              <Text size="meta" bare tone="muted" role="status">
                {notice}
              </Text>
            ) : null}
          </>
        ) : undefined
      }
    />
  );
}
