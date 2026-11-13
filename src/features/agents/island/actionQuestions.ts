import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, UserAttentionType } from "@tauri-apps/api/window";
import { create } from "zustand";
import { rememberSiteGrant } from "../grants/localSiteGrants";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { startTellingNativeTheAccount } from "../personal/agentAccount";

/**
 * Stop before paying, sending, deleting or posting. The desktop
 * pauses an agent's page step natively and asks here; the control island shows
 * the question until the person answers or it times out.
 */
interface ActionQuestion {
  id: string;
  /** "action": any other step, which Ask mode stops before. */
  kind: "payment" | "send" | "delete" | "publish" | "action";
  control: string;
  reason: string;
  site: string;
  /** The page's origin, which "Accept and remember" names. */
  origin?: string;
  /** Sends, deletes and publishes on a secure page can be remembered; payments never. */
  rememberable?: boolean;
  agentId: string;
  taskId: string;
}

export const useActionQuestions = create<{ items: ActionQuestion[] }>(() => ({ items: [] }));

let listening = false;
export function listenForActionQuestions() {
  if (listening || !hasTauriInternals()) return;
  listening = true;
  startTellingNativeTheAccount();
  const window = getCurrentWindow();
  void window.listen<ActionQuestion>("misty://agent-action-confirm", ({ payload }) => {
    useActionQuestions.setState((state) => ({
      items: [...state.items.filter((item) => item.id !== payload.id), payload],
    }));
    // The agent may be working in a background tab or window.
    void window.requestUserAttention(UserAttentionType.Critical).catch(() => {});
  });
  void window.listen<{ id: string }>("misty://agent-action-confirm-closed", ({ payload }) => {
    useActionQuestions.setState((state) => ({
      items: state.items.filter((item) => item.id !== payload.id),
    }));
  });
}

/**
 * Answers a question. "remember" also stores the grant for this agent, kind and
 * site first, so the next step on the same site continues while the chat is in Auto.
 */
export async function answerActionQuestion(id: string, allow: boolean, remember = false) {
  const question = useActionQuestions.getState().items.find((item) => item.id === id);
  try {
    if (allow && remember && question?.rememberable && question.origin)
      await rememberSiteGrant({
        agentId: question.agentId,
        kind: question.kind,
        origin: question.origin,
      });
    await invoke("agent_action_confirm", { id, allow });
  } finally {
    useActionQuestions.setState((state) => ({
      items: state.items.filter((item) => item.id !== id),
    }));
  }
}

export function actionQuestionVerb(question: Pick<ActionQuestion, "kind">) {
  return {
    payment: "pay or buy",
    send: "send messages",
    delete: "delete things",
    publish: "post or publish",
    action: "take this step",
  }[question.kind];
}

/** A question about a whole call is shown in full below its sentence, however long it is. */
export function actionQuestionHasDetails(question: Pick<ActionQuestion, "control">) {
  return question.control.includes("\n") || question.control.length > 120;
}

export function actionQuestionText(question: ActionQuestion, agentName: string) {
  const verb = {
    payment: "pay or buy",
    send: "send a message",
    delete: "delete something",
    publish: "post or publish",
    action: "take this step",
  }[question.kind];
  const where = question.site ? ` on ${question.site}` : "";
  if (actionQuestionHasDetails(question)) return `${agentName} wants to ${verb}${where}:`;
  return `${agentName} wants to ${verb}${where}: ${question.control}.`;
}
