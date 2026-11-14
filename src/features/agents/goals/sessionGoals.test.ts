import { expect, it } from "vitest";
import { afterGoalTurn, agreedGoal, GOAL_MET, goalPrompt, MOST_TURNS } from "./sessionGoals";

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

it("loops a prompt the number of times asked", () => {
  const loop = { text: "Run the tests", turns: 0, kind: "loop" as const, times: 3 };
  const reply = { state: "completed", content: "Ran them." };
  expect(afterGoalTurn(loop, reply)).toBe("continue");
  expect(afterGoalTurn({ ...loop, turns: 2 }, reply)).toBe("met");
});

it("takes the goal a guided interview agreed on", () => {
  expect(agreedGoal("Sounds good.\nGOAL: Every page loads under a second")).toBe(
    "Every page loads under a second",
  );
  expect(agreedGoal("What should it cover?")).toBeUndefined();
  const guided = { text: "", turns: 0, kind: "guided" as const };
  expect(afterGoalTurn(guided, { state: "completed", content: "Which pages?" })).toBe("wait");
});
