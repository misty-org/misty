import { describe, expect, it } from "vitest";
import { activityTargetHref } from "./activityNavigation";

describe("activityTargetHref", () => {
  it("builds current Space routes for activity targets", () => {
    expect(activityTargetHref({ kind: "space-chat", spaceId: "a space", messageId: "m/1" })).toBe(
      "/spaces/a%20space/chat?message=m%2F1",
    );
    expect(activityTargetHref({ kind: "space-task", spaceId: "space-1", taskId: "task-1" })).toBe(
      "/spaces/space-1/planner/tasks/board?task=task-1",
    );
  });

  it("maps workspace tools and ignores empty targets", () => {
    expect(activityTargetHref({ kind: "workspace-tool", tool: "agents" })).toBe("/agents");
    expect(activityTargetHref({ kind: "none" })).toBeNull();
  });
});
