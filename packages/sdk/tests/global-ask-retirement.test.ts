import { describe, expect, it } from "vitest";
import { mistyAgentsContracts, mistySocialContracts, mistyServerContracts, TaskCreateInputSchema } from "@misty/contracts";

describe("global Ask breaking contracts", () => {
  it("rejects retired agent selection and membership operations", () => {
    for (const operation of ["agents.list", "agents.activity", "agents.create", "agents.select"]) {
      expect(mistyAgentsContracts["agents.perform"].params.safeParse({ operation, args: [] }).success).toBe(false);
    }
    for (const operation of ["chatAgents", "actionSuggestions", "conversationSuggestionVeto"]) {
      expect(mistySocialContracts["social.perform"].params.safeParse({ operation, args: [] }).success).toBe(false);
    }
    expect(mistyAgentsContracts["agents.perform"].params.safeParse({ operation: "ai.createInvocation", args: [] }).success).toBe(true);
  });
  it("does not expose agents as Space members or task assignees", () => {
    expect(mistyServerContracts["spaces.members.list"].result.parse({ members: [] })).toEqual({ members: [] });
    expect(TaskCreateInputSchema.safeParse({ title: "Work", assignee_agent_id: "retired" }).success).toBe(false);
    expect(TaskCreateInputSchema.safeParse({ title: "Work", agent_run: { mode: "auto" } }).success).toBe(false);
    expect(TaskCreateInputSchema.safeParse({ title: "Work", assignee_user_id: "person" }).success).toBe(true);
  });
});
