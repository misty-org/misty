import { changeConversationState, publicQuestionSet } from "../tools/run-state/conversation_state";
import { endOpenQuestionSets } from "../tools/run-state/questions";
import { useCollaborationStore } from "./store";
import type { ConversationMode, PermissionMode } from "./plan_types";

export async function admitLocalTurn(
  account: string,
  conversationId: string,
  turn: {
    mode?: ConversationMode;
    permissionMode?: PermissionMode;
  },
): Promise<void> {
  if (conversationId.startsWith("local-")) return;
  const ended = await changeConversationState(account, conversationId, (state) => {
    const { state: closed, ended } = endOpenQuestionSets(state, "superseded");
    return {
      next: {
        ...closed,
        mode: turn.mode ?? closed.mode,
        permissionMode: turn.permissionMode ?? closed.permissionMode,
      },
      result: ended,
    };
  });
  showEnded(conversationId, ended);
}

export async function supersedeRunQuestions(
  account: string,
  conversationId: string,
  runId: string,
): Promise<void> {
  const ended = await changeConversationState(account, conversationId, (state) => {
    const closing = endOpenQuestionSets(state, "superseded", runId);
    return { next: closing.state, result: closing.ended };
  });
  showEnded(conversationId, ended);
}

function showEnded(conversationId: string, ended: Parameters<typeof publicQuestionSet>[0][]) {
  for (const set of ended)
    useCollaborationStore.getState().applyEvent(conversationId, {
      type: "question.answered",
      questionSet: publicQuestionSet(set),
    });
}

export async function loadLocalModes(account: string, conversationId: string): Promise<void> {
  const store = useCollaborationStore.getState();
  store.setAccount(account);
  await store.load(conversationId);
}
