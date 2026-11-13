import { changeConversationState, publicQuestionSet } from "../tools/run-state/conversationState";
import { endOpenQuestionSets } from "../tools/run-state/questions";
import { useCollaborationStore } from "./store";
import type { ConversationMode, PermissionMode } from "./planTypes";

/**
 * What the server did as it admitted a turn, for a chat whose state is here: keeps the modes the turn
 * chose, and treats a typed message as the answer to any open questions.
 */
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

/** A message sent while the run waits on questions answers them; the waiting call returns and reads it. */
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

/** A chat's saved modes, read before a turn is sent from a window that hasn't opened the chat. */
export async function loadLocalModes(account: string, conversationId: string): Promise<void> {
  const store = useCollaborationStore.getState();
  store.setAccount(account);
  await store.load(conversationId);
}
