import { describe, it, expect } from "vitest";
import {
  AgentProfileInputSchema,
  AgentTaskContextSchema,
  MistyBrowserInteractionSchema,
  mistyBrowserContracts,
} from "../../contracts/src/index.js";
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
  it("binds a personal task to its agent, mode and window while preserving historical scopes", () => {
    expect(
      AgentTaskContextSchema.safeParse({
        taskId: "task",
        agentId: "a",
        spaceId: "s",
        executionMode: "team",
        windowLabel: "misty-agent-one",
      }).success,
    ).toBe(true);
    expect(
      AgentTaskContextSchema.safeParse({ agentId: "a", spaceId: "s", executionMode: "team" })
        .success,
    ).toBe(false);
  });
  it("accepts the personal workspace without inventing a Space", () => {
    const task = { taskId: "task", agentId: "agent", executionMode: "agent", windowLabel: "main" };
    expect(AgentTaskContextSchema.parse(task).spaceId).toBe("");
    expect(AgentTaskContextSchema.parse({ ...task, spaceId: "" }).spaceId).toBe("");
    expect(AgentTaskContextSchema.safeParse({ ...task, spaceId: "s".repeat(257) }).success).toBe(
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
  it("registers configured destinations without caller-chosen app or Space authority", () => {
    const request = {
      destinations: [
        {
          provider: { id: "instagram", accountId: "brand" },
          label: "Brand",
          url: "https://www.instagram.com/",
        },
      ],
    };
    expect(
      mistyBrowserContracts["browser.destinations.set"].params.safeParse(request).success,
    ).toBe(true);
    expect(
      mistyBrowserContracts["browser.destinations.set"].params.safeParse({
        ...request,
        spaceId: "another-space",
      }).success,
    ).toBe(false);
  });
});
