import type { GlobalAiConversation, GlobalAiMessage } from "@/features/global-search/types";
import { useMistyStore } from "@/features/misty/useMistyStore";
import { useCollaborationStore } from "../collaboration/store";
import { companionReply } from "../companion/companionReply";
import { routeTarget } from "./lessonRouter";
import { useLessonStore } from "./lessonStore";

/**
 * Keeps lessons in step with their chats: each finished Teach reply updates its
 * lesson, and a reply that starts or resumes a different lesson moves its turn
 * into that lesson's chat (docs/design/agents-at-cursor/BRIEF.md, revision 4).
 */
export function followLessons(accountId: string): () => void {
  void useLessonStore.getState().load(accountId);
  const handled = new Set<string>();
  let queue = Promise.resolve();
  const unsubscribe = useMistyStore.subscribe((state, previous) => {
    if (!state?.conversations || !previous?.conversations) return;
    if (state.accountId !== accountId || state.conversations === previous.conversations) return;
    const before = new Map(previous.conversations.map((c) => [c.id, lastMessage(c)]));
    // A deleted chat takes its lesson with it.
    const present = new Set(state.conversations.map((c) => c.id));
    for (const id of before.keys())
      if (!present.has(id) && useLessonStore.getState().lessons[id])
        useLessonStore.getState().remove(id);
    for (const conversation of state.conversations) {
      const reply = lastMessage(conversation);
      if (
        !reply ||
        reply.role !== "assistant" ||
        reply.state !== "completed" ||
        !reply.invocationId
      )
        continue;
      // Only a reply finishing now: chats loaded from disk are already settled.
      const earlier = before.get(conversation.id);
      if (!earlier || (earlier.id === reply.id && earlier.state === "completed")) continue;
      if (handled.has(reply.invocationId) || !isLessonReply(conversation, reply)) continue;
      handled.add(reply.invocationId);
      queue = queue.then(() => settleLessonReply(conversation.id, reply)).catch(() => undefined);
    }
  });
  return () => {
    unsubscribe();
    handled.clear();
  };
}

function lastMessage(conversation: GlobalAiConversation): GlobalAiMessage | undefined {
  return conversation.messages[conversation.messages.length - 1];
}

function isLessonReply(conversation: GlobalAiConversation, reply: GlobalAiMessage): boolean {
  if (useCollaborationStore.getState().modeFor(conversation.id) === "teach") return true;
  return /\[(?:ROUTE|LESSON):/.test(reply.content);
}

async function settleLessonReply(conversationId: string, reply: GlobalAiMessage) {
  const runId = reply.invocationId!;
  const parsed = companionReply(reply.content);
  const lessons = useLessonStore.getState().lessons;
  if (Object.values(lessons).some((lesson) => lesson.appliedRuns.includes(runId))) return;
  const conversation = useMistyStore.getState().conversations.find((c) => c.id === conversationId);
  const agentId = conversation?.agentId;
  const replyIndex = conversation?.messages.findIndex((m) => m.invocationId === runId) ?? -1;
  const earlierTurns = (conversation?.messages ?? [])
    .slice(0, Math.max(0, replyIndex - 1))
    .some((m) => m.role === "assistant");
  const target = routeTarget(lessons, conversationId, parsed.route, earlierTurns);
  let lessonId = conversationId;
  if (target.kind === "resume") {
    lessonId = target.id;
    moveTurn(conversationId, lessonId, runId);
  } else if (target.kind === "new") {
    lessonId = await useMistyStore.getState().newConversation(undefined, agentId);
    await useCollaborationStore.getState().setMode(lessonId, "teach");
    moveTurn(conversationId, lessonId, runId);
    void useMistyStore
      .getState()
      .renameConversation(lessonId, target.title)
      .catch(() => undefined);
  }
  useLessonStore.getState().apply({
    lessonId,
    runId,
    route: parsed.route,
    patch: parsed.lesson,
    course: parsed.course,
    agentId,
  });
}

/**
 * Moves the turn that produced `runId` (the person's message and the reply) from one
 * chat to another and shows the other chat. A chat left with nothing in it is removed.
 */
export function moveTurn(fromId: string, toId: string, runId: string) {
  const state = useMistyStore.getState();
  const from = state.conversations.find((c) => c.id === fromId);
  const to = state.conversations.find((c) => c.id === toId);
  if (!from || !to || fromId === toId) return;
  const replyIndex = from.messages.findIndex(
    (m) => m.role === "assistant" && m.invocationId === runId,
  );
  if (replyIndex < 0) return;
  const start = from.messages[replyIndex - 1]?.role === "user" ? replyIndex - 1 : replyIndex;
  const moved = from.messages.slice(start, replyIndex + 1);
  const rest = [...from.messages.slice(0, start), ...from.messages.slice(replyIndex + 1)];
  const now = new Date().toISOString();
  useMistyStore.setState({
    conversations: state.conversations.map((c) =>
      c.id === fromId
        ? { ...c, messages: rest }
        : c.id === toId
          ? { ...c, messages: [...c.messages, ...moved], updatedAt: now }
          : c,
    ),
  });
  useMistyStore.getState().selectConversation(toId);
  if (!rest.length)
    void useMistyStore
      .getState()
      .deleteConversation(fromId)
      .catch(() => undefined);
}
