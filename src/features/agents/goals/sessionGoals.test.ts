import { expect, it } from "vitest";
import { afterGoalTurn, GOAL_MET, goalPrompt, MOST_TURNS } from "./sessionGoals";

const goal = { text: "All tests pass", turns: 0 };

it("goes on until the agent says the goal is met", () => {
  expect(afterGoalTurn(goal, { state: "completed", content: "Fixed two tests." })).toBe("continue");
  expect(afterGoalTurn(goal, { state: "completed", content: `Done.\n${GOAL_MET}` })).toBe("met");
});

it("waits for the person after a failed or stopped turn, and after going on too long", () => {
  expect(afterGoalTurn(goal, { state: "failed", content: "boom" })).toBe("wait");
  expect(afterGoalTurn(goal, { state: "canceled", content: "" })).toBe("wait");
  expect(afterGoalTurn(goal, undefined)).toBe("wait");
  expect(
    afterGoalTurn({ ...goal, turns: MOST_TURNS }, { state: "completed", content: "More to do." }),
  ).toBe("wait");
});

it("tells the agent the goal and how to say it is met", () => {
  expect(goalPrompt("Ship it")).toContain("Ship it");
  expect(goalPrompt("Ship it")).toContain(GOAL_MET);
});
