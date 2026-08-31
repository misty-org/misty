import { describe, expect, it } from "vitest";
import { buildPublicFeedbackIssueUrl, publicFeedbackRepository } from "./feedbackIssue";

describe("public feedback issue", () => {
  it("opens the source-free public repository with a reviewable draft", () => {
    const url = new URL(
      buildPublicFeedbackIssueUrl(
        {
          kind: "bug",
          summary: "Planner loses focus",
          area: "Planner",
          details: "The title field loses focus after I add a task.",
          expected: "Keep the title field focused.",
          frequency: "always",
        },
        { appVersion: "0.1.0", platform: "macos", releaseChannel: "public_beta" },
      ),
    );

    expect(`${url.origin}${url.pathname}`).toBe(`${publicFeedbackRepository}/issues/new`);
    expect(url.searchParams.get("title")).toBe("[Bug] Planner loses focus");
    expect(url.searchParams.get("body")).toContain("No diagnostic bundle was uploaded");
    expect(url.searchParams.get("body")).toContain("Version: 0.1.0");
  });

  it("caps user-authored fields so the handoff URL stays bounded", () => {
    const url = buildPublicFeedbackIssueUrl({
      kind: "idea",
      summary: "a".repeat(500),
      area: "General",
      details: "b".repeat(10_000),
      expected: "c".repeat(10_000),
      frequency: "unknown",
    });

    expect(url.length).toBeLessThan(9_000);
  });
});
