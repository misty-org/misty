import { describe, it, expect } from "vitest";
import { AgentProfileInputSchema, MistyBrowserInteractionSchema } from "../index.ts";
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
  it("bounds visual points and rejects browser filesystem paths", () => {
    expect(MistyBrowserInteractionSchema.parse({ kind: "point", x: 0.5, y: 0.1 })).toEqual({
      kind: "point",
      x: 0.5,
      y: 0.1,
    });
    expect(MistyBrowserInteractionSchema.safeParse({ kind: "point", x: 1.1, y: 0 }).success).toBe(
      false,
    );
    expect(
      MistyBrowserInteractionSchema.safeParse({ kind: "upload", path: "/private/file" }).success,
    ).toBe(false);
  });
});
