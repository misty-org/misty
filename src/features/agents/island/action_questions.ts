import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, UserAttentionType } from "@tauri-apps/api/window";
import { useMemo } from "react";
import { create } from "zustand";
import { rememberSiteGrant } from "../grants/local_site_grants";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { startTellingNativeTheAccount } from "../personal/agent_account";

export interface ActionQuestion {
  id: string;
  kind: "payment" | "send" | "delete" | "publish" | "account" | "action";
  control: string;
  reason: string;
  site: string;
  origin?: string;
  rememberable?: boolean;
  agentId: string;
  taskId: string;
}

export const useActionQuestions = create<{ items: ActionQuestion[] }>(() => ({ items: [] }));

export const useDockedQuestionAgents = create<{ counts: Record<string, number> }>(() => ({
  counts: {},
}));

export function dockQuestionsFor(agentId: string) {
  const change = (by: number) =>
    useDockedQuestionAgents.setState((state) => {
      const next = (state.counts[agentId] ?? 0) + by;
      const counts = { ...state.counts };
      if (next > 0) counts[agentId] = next;
      else delete counts[agentId];
      return { counts };
    });
  change(1);
  return () => change(-1);
}

export function useIslandQuestions(): ActionQuestion[] {
  const items = useActionQuestions((state) => state.items);
  const docked = useDockedQuestionAgents((state) => state.counts);
  return useMemo(() => items.filter((item) => !docked[item.agentId]), [items, docked]);
}

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
    void window.requestUserAttention(UserAttentionType.Critical).catch(() => {});
  });
  void window.listen<{ id: string }>("misty://agent-action-confirm-closed", ({ payload }) => {
    useActionQuestions.setState((state) => ({
      items: state.items.filter((item) => item.id !== payload.id),
    }));
  });
}

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
    account: "use your account",
    action: "take this step",
  }[question.kind];
}

export function actionQuestionRemembers(question: Pick<ActionQuestion, "kind" | "origin">) {
  if (question.kind === "account") return `Always allow using your account on ${question.origin}`;
  return `Always allow ${actionQuestionVerb(question)} on ${question.origin} while the chat is in Auto`;
}

export function actionQuestionHasDetails(question: Pick<ActionQuestion, "control">) {
  return question.control.includes("\n") || question.control.length > 120;
}

export function actionQuestionText(question: ActionQuestion, agentName: string) {
  const verb = {
    payment: "pay or buy",
    send: "send a message",
    delete: "delete something",
    publish: "post or publish",
    account: "use your account",
    action: "take this step",
  }[question.kind];
  const where = question.site ? ` on ${question.site}` : "";
  if (!question.control) return `${agentName} wants to ${verb}${where}.`;
  if (actionQuestionHasDetails(question)) return `${agentName} wants to ${verb}${where}:`;
  return `${agentName} wants to ${verb}${where}: ${question.control}.`;
}
