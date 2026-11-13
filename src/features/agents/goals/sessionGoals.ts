import { useEffect, useRef } from "react";
import { create } from "zustand";
import { useMistyStore } from "../conversations/state/useMistyStore";

/** The line an agent ends its reply with once the goal is met. */
export const GOAL_MET = "GOAL MET";
/** How many times a chat goes on by itself toward one goal before it stops and waits. */
export const MOST_TURNS = 8;

interface SessionGoal {
  text: string;
  /** Turns Misty has sent by itself for this goal. */
  turns: number;
}

/**
 * A chat's goal: with one set, the chat keeps asking its agent to go on until the agent says
 * the goal is met, the person stops it, or it has gone on by itself too many times. Kept for
 * this window's session only.
 */
export const useSessionGoals = create<{
  goals: Record<string, SessionGoal>;
  set(conversationId: string, text: string): void;
  clear(conversationId: string): void;
  count(conversationId: string): void;
  /** A chat that hadn't started got its id: its goal goes with it. */
  move(from: string, to: string): void;
}>((set, get) => ({
  goals: {},
  set: (conversationId, text) =>
    set({ goals: { ...get().goals, [conversationId]: { text: text.trim(), turns: 0 } } }),
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

/** What the chat sends to carry on toward a goal. */
export const goalPrompt = (goal: string) =>
  `Keep working toward this goal until it is fully met: ${goal}\n\n` +
  `If it is already met, say so briefly. When it is met, end your reply with the line ${GOAL_MET}.`;

/** What to do when a turn ends in a chat that has a goal. */
export function afterGoalTurn(
  goal: SessionGoal,
  reply: { state?: string; content: string } | undefined,
): "met" | "continue" | "wait" {
  // A turn that failed, was stopped, or waits on the person is theirs to pick up.
  if (!reply || reply.state !== "completed") return "wait";
  if (reply.content.includes(GOAL_MET)) return "met";
  return goal.turns >= MOST_TURNS ? "wait" : "continue";
}

/** Carries the open chat on toward its goal each time its agent finishes a turn. */
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
    const next = afterGoalTurn(goal, reply);
    if (next === "met") useSessionGoals.getState().clear(conversationId);
    if (next !== "continue") return;
    useSessionGoals.getState().count(conversationId);
    chat.setQuery(goalPrompt(goal.text));
    void chat.submit();
  }, [working, conversationId]);
}
