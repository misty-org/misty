import { describe, it, expect } from "vitest";
import { AgentProfileInputSchema } from "../index.ts";
describe("native personal agents", () => {
  it("defaults to personal instructions and no implicit app assignments", () => {
    const agent = AgentProfileInputSchema.parse({
      name: "Communications",
      role: "Launch communications",
    });
    expect(agent.model_mode).toBe("automatic");
    expect(agent.enabled).toBe(true);
    expect(AgentProfileInputSchema.safeParse({ ...agent, app_ids: ["planner"] }).success).toBe(
      false,
    );
  });
});
