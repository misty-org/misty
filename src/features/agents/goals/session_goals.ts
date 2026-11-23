import { useEffect, useRef } from "react";
import { create } from "zustand";
import { useMistyStore } from "../conversations/state/use_misty_store";

export const GOAL_MET = "GOAL MET";
export const MOST_TURNS = 8;

interface SessionGoal {
  text: string;
  turns: number;
  kind?: "goal" | "loop" | "guided";
  times?: number;
}

export const useSessionGoals = create<{
  goals: Record<string, SessionGoal>;
  set(conversationId: string, text: string, kind?: SessionGoal["kind"], times?: number): void;
  clear(conversationId: string): void;
  count(conversationId: string): void;
  move(from: string, to: string): void;
}>((set, get) => ({
  goals: {},
  set: (conversationId, text, kind = "goal", times) =>
    set({
      goals: { ...get().goals, [conversationId]: { text: text.trim(), turns: 0, kind, times } },
    }),
  clear: (conversationId) => {
    const goals = { ...get().goals };
    delete goals[conversationId];
    set({ goals });
  },
  move: (from, to) => {
    const goal = get().goals[from];
    if (!goal || get().goals[to]) return;
    const goals = { ...get().goals, [to]: goal };
    delete goals[from];
    set({ goals });
  },
  count: (conversationId) => {
    const goal = get().goals[conversationId];
    if (goal)
      set({ goals: { ...get().goals, [conversationId]: { ...goal, turns: goal.turns + 1 } } });
  },
}));

export const goalPrompt = (goal: string) =>
  `Keep working toward this goal until it is fully met: ${goal}\n\n` +
  `If it is already met, say so briefly. When it is met, end your reply with the line ${GOAL_MET}.`;

export const guidedGoalPrompt = (rough: string) =>
  `Help me turn this into a clear goal you can work toward on your own${
    rough ? `: ${rough}` : ""
  }\n\nAsk me what you need to know, a few questions at a time. Once we agree, end your reply ` +
  `with one line that starts with "GOAL:" and states the goal in full, then start on it.`;

export function agreedGoal(content: string): string | undefined {
  const lines = content.split("\n").filter((line) => /^\s*GOAL:/.test(line));
  return lines[lines.length - 1]?.replace(/^\s*GOAL:\s*/, "").trim() || undefined;
}

export function afterGoalTurn(
  goal: SessionGoal,
  reply: { state?: string; content: string } | undefined,
): "met" | "continue" | "wait" {
  if (!reply || reply.state !== "completed") return "wait";
  if (goal.kind === "loop")
    return goal.turns + 1 >= (goal.times ?? MOST_TURNS) ? "met" : "continue";
  if (goal.kind === "guided") return "wait";
  if (reply.content.includes(GOAL_MET)) return "met";
  return goal.turns >= MOST_TURNS ? "wait" : "continue";
}

export function useSessionGoalRunner(conversationId: string) {
  const working = useMistyStore((state) => state.working);
  const was = useRef(working);
  useEffect(() => {
    const finished = was.current && !working;
    was.current = working;
    if (!finished || !conversationId) return;
    const goal = useSessionGoals.getState().goals[conversationId];
    if (!goal) return;
    const chat = useMistyStore.getState();
    if (chat.activeConversationId !== conversationId || chat.query.trim()) return;
    const messages = chat.conversations.find((item) => item.id === conversationId)?.messages ?? [];
    const reply = [...messages].reverse().find((message) => message.role === "assistant");
    if (goal.kind === "guided" && reply?.state === "completed") {
      const agreed = agreedGoal(reply.content);
      if (!agreed) return;
      useSessionGoals.getState().set(conversationId, agreed);
      useSessionGoals.getState().count(conversationId);
      chat.setQuery(goalPrompt(agreed));
      void chat.submit();
      return;
    }
    const next = afterGoalTurn(goal, reply);
    if (next === "met") useSessionGoals.getState().clear(conversationId);
    if (next !== "continue") return;
    useSessionGoals.getState().count(conversationId);
    chat.setQuery(goal.kind === "loop" ? goal.text : goalPrompt(goal.text));
    void chat.submit();
  }, [working, conversationId]);
}
