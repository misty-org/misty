import { describe, expect, it } from "vitest";
import type { AiProgressItem } from "@/features/ai-surface/types";
import { usageLimitNotice, usageLimitNotices } from "./usageLimits";

const tool = (error?: string): AiProgressItem => ({
  type: "tool",
  id: crypto.randomUUID(),
  name: "integration.execute",
  state: error ? "failed" : "completed",
  error,
});

describe("monthly limits in the chat", () => {
  it("names a used-up allowance by its code or the server's words", () => {
    expect(usageLimitNotice("app_action_limit_reached: This account used its 1000")).toContain(
      "this month's app actions",
    );
    expect(
      usageLimitNotice("This account used its 5 app actions for this month. Tell the user"),
    ).toContain("this month's app actions");
    expect(usageLimitNotice("The tool could not complete this action.")).toBeNull();
    expect(usageLimitNotice(undefined)).toBeNull();
  });

  it("says each limit once for a reply", () => {
    const notices = usageLimitNotices([
      tool("app_action_limit_reached: used up"),
      tool("app_action_limit_reached: used up"),
      tool(),
      { type: "note", text: "app_action_limit_reached" },
    ]);
    expect(notices).toHaveLength(1);
    expect(notices[0]).not.toContain("app_action_limit_reached");
  });
});
