import { chatKey } from "../../state/draft_chat";
import {
  goalPrompt,
  guidedGoalPrompt,
  MOST_TURNS,
  useSessionGoals,
} from "../../../goals/session_goals";
import { done, type MistyCommand } from "./command_kit";

export const goalCommands: readonly MistyCommand[] = [
  {
    name: "goal",
    description: "Keep the agent going until a goal is met",
    hint: "[goal|clear]",
    on: "all",
    run: (args, scope) => {
      const key = chatKey(scope.conversationId);
      const goals = useSessionGoals.getState();
      if (args.toLowerCase() === "clear") {
        goals.clear(key);
        return done("Goal cleared");
      }
      if (!args) {
        const goal = goals.goals[key];
        return done(goal ? `Goal: ${goal.text}` : "Type a goal after /goal");
      }
      goals.set(key, args);
      return { send: goalPrompt(args) };
    },
  },
  {
    name: "guided-goal",
    description: "Have the agent interview you, then work toward the goal you agree on",
    hint: "[rough goal]",
    on: "all",
    run: (args, scope) => {
      useSessionGoals.getState().set(chatKey(scope.conversationId), args, "guided");
      return { send: guidedGoalPrompt(args) };
    },
  },
  {
    name: "loop",
    description: "Send a prompt again after each reply",
    hint: "[times] <prompt>",
    on: "all",
    run: (args, scope) => {
      const match = /^(\d+)\s+([\s\S]+)$/.exec(args);
      const times = match ? Math.max(1, Number.parseInt(match[1], 10)) : MOST_TURNS;
      const prompt = (match ? match[2] : args).trim();
      if (!prompt) return done("Type what to send after /loop");
      useSessionGoals.getState().set(chatKey(scope.conversationId), prompt, "loop", times);
      return { send: prompt };
    },
  },
];
