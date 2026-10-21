import { useMistyStore } from "@/features/misty/useMistyStore";
import { useCollaborationStore } from "../collaboration/store";
import { activeLesson } from "./lessonStore";

/**
 * The chat a Teach-mode turn at the cursor goes to, shown in Agents: the lesson in
 * progress, or the open chat when it is already a lesson. Without either, a new
 * Teach chat; its first reply names the lesson.
 */
export async function lessonConversation(): Promise<string> {
  const id = currentLessonConversation();
  if (id) return id;
  const created = await useMistyStore
    .getState()
    .newConversation(undefined, useMistyStore.getState().selectedAgentId);
  await useCollaborationStore.getState().setMode(created, "teach");
  return created;
}

/**
 * The lesson chat to use without waiting, selected if it is not open: used when a
 * spoken turn starts, which cannot wait for a new chat. Undefined when there is none.
 */
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
