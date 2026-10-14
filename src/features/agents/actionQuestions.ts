import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, UserAttentionType } from "@tauri-apps/api/window";
import { create } from "zustand";
import { hasTauriInternals } from "@/shared/platform/tauri";

/**
 * Stop before paying, sending, deleting or posting (roadmap C2). The desktop
 * pauses an agent's page step natively and asks here; the control island shows
 * the question until the person answers or it times out.
 */
export interface ActionQuestion {
  id: string;
  kind: "payment" | "send" | "delete" | "publish";
  control: string;
  reason: string;
  site: string;
  agentId: string;
  taskId: string;
}

export const useActionQuestions = create<{ items: ActionQuestion[] }>(() => ({ items: [] }));

let listening = false;
export function listenForActionQuestions() {
  if (listening || !hasTauriInternals()) return;
  listening = true;
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

// Questions asked from this window (desktop control) rather than natively.
const local = new Map<string, (allow: boolean) => void>();
const localWaitMs = 180_000;

export function kindOf(description: string): ActionQuestion["kind"] {
  if (
    /\b(pay|buy|purchase|order|checkout|check out|donate|transfer|subscribe)\b/i.test(description)
  )
    return "payment";
  if (/\b(delete|remove|erase|discard|trash|cancel)\b/i.test(description)) return "delete";
  if (/\b(publish|post|tweet|share|make public)\b/i.test(description)) return "publish";
  return "send";
}

/**
 * Asks the person before a consequential desktop-control action. Resolves
 * false when they refuse or don't answer within three minutes.
 */
export function askPerson(input: {
  description: string;
  agentId: string;
  taskId: string;
  site?: string;
}): Promise<boolean> {
  const id = crypto.randomUUID();
  return new Promise((resolve) => {
    const finish = (allow: boolean) => {
      clearTimeout(timer);
      local.delete(id);
      useActionQuestions.setState((state) => ({
        items: state.items.filter((item) => item.id !== id),
      }));
      resolve(allow);
    };
    const timer = setTimeout(() => finish(false), localWaitMs);
    local.set(id, finish);
    useActionQuestions.setState((state) => ({
      items: [
        ...state.items,
        {
          id,
          kind: kindOf(input.description),
          control: input.description,
          reason: "",
          site: input.site ?? "",
          agentId: input.agentId,
          taskId: input.taskId,
        },
      ],
    }));
  });
}

export async function answerActionQuestion(id: string, allow: boolean) {
  const finish = local.get(id);
  if (finish) return finish(allow);
  try {
    await invoke("agent_action_confirm", { id, allow });
  } finally {
    useActionQuestions.setState((state) => ({
      items: state.items.filter((item) => item.id !== id),
    }));
  }
}

export function actionQuestionText(question: ActionQuestion, agentName: string) {
  const verb = {
    payment: "pay or buy",
    send: "send a message",
    delete: "delete something",
    publish: "post or publish",
  }[question.kind];
  const where = question.site ? ` on ${question.site}` : "";
  return `${agentName} wants to ${verb}${where}: ${question.control}.`;
}
