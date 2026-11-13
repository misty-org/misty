import { expect, it } from "vitest";
import { doingLabel, memberAgentsIn } from "./memberAgents";

it("lists the members heard from recently and drops the ones gone quiet", () => {
  const now = 1_000_000;
  const bySpace = {
    s1: {
      sam: {
        at: now - 10_000,
        agents: [{ id: "a", name: "Scout", state: "working", doing: "shell" }],
      },
      ana: { at: now - 200_000, agents: [{ id: "b", name: "Old", state: "resting", doing: "" }] },
    },
  } as const;
  expect(memberAgentsIn({ bySpace: bySpace as never }, "s1", now)).toEqual([
    { userId: "sam", agent: { id: "a", name: "Scout", state: "working", doing: "shell" } },
  ]);
  expect(memberAgentsIn({ bySpace: bySpace as never }, "other", now)).toEqual([]);
});

it("turns a status code into plain words", () => {
  expect(doingLabel("shell", "working")).toBe("Running a command");
  expect(doingLabel("unknown-code", "working")).toBe("Working");
  expect(doingLabel("shell", "needs-you")).toBe("Waiting for its person");
  expect(doingLabel("shell", "resting")).toBe("");
});
