import { useMistyStore } from "../../conversations/state/use_misty_store";
import { useCollaborationStore } from "../../plans/store";
import { activeLesson } from "./lesson_store";

export async function lessonConversation(): Promise<string> {
  const id = currentLessonConversation();
  if (id) return id;
  const created = await useMistyStore
    .getState()
    .newConversation(undefined, useMistyStore.getState().selectedAgentId);
  await useCollaborationStore.getState().setMode(created, "teach");
  return created;
}

export function currentLessonConversation(): string | undefined {
  const misty = useMistyStore.getState();
  const exists = (id: string) => misty.conversations.some((c) => c.id === id);
  const lesson = activeLesson(misty.selectedAgentId);
  let id = lesson && exists(lesson.id) ? lesson.id : undefined;
  if (
    !id &&
    exists(misty.activeConversationId) &&
    useCollaborationStore.getState().modeFor(misty.activeConversationId) === "teach"
  )
    id = misty.activeConversationId;
  if (id && misty.activeConversationId !== id) misty.selectConversation(id);
  return id;
}
