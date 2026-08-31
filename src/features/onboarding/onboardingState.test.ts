import { beforeEach, describe, expect, it } from "vitest";
import {
  onboardingStartRoute,
  readOnboardingCompletion,
  suggestedSpaceName,
  writeOnboardingCompletion,
} from "./onboardingState";

describe("onboarding state", () => {
  beforeEach(() => window.localStorage.clear());

  it("stores completion per account", () => {
    writeOnboardingCompletion("account-a", {
      outcome: "completed",
      purpose: "plan",
      start: "task",
      hostedAiEnabled: true,
    });

    expect(readOnboardingCompletion("account-a")).toMatchObject({
      version: 1,
      outcome: "completed",
      purpose: "plan",
      start: "task",
      hostedAiEnabled: true,
    });
    expect(readOnboardingCompletion("account-b")).toBeNull();
  });

  it("opens a concrete first action", () => {
    expect(onboardingStartRoute("space / one", "note")).toBe(
      "/spaces/space%20%2F%20one/notes?create=note",
    );
    expect(onboardingStartRoute("space-1", "task")).toContain("?create=task");
    expect(onboardingStartRoute("space-1", "social")).toBe("/spaces/space-1/social/misty");
    expect(onboardingStartRoute("space-1", "library")).toContain("?upload=1");
  });

  it("suggests a useful Space name from purpose", () => {
    expect(suggestedSpaceName("organize")).toBe("My knowledge");
    expect(suggestedSpaceName("explore")).toBe("My Space");
  });
});
