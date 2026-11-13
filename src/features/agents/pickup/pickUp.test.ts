import { describe, expect, it } from "vitest";
import { pickUpMarkdown, pickUpRequest, pickUpTitle, pickUpTopic } from "./pickUp";

describe("pick-ups", () => {
  it("is marked by its title", () => {
    expect(pickUpTitle("  Fix the   login page ")).toBe("Pick up: Fix the login page");
    expect(pickUpTopic("Pick up: Fix the login page")).toBe("Fix the login page");
    expect(pickUpTopic("pick up:")).toBe("Untitled work");
    expect(pickUpTopic("Meeting notes")).toBeUndefined();
  });

  it("ends with where it came from, naming the folder and never its path", () => {
    const note = pickUpMarkdown("## Done\nThe form.", {
      agentName: "Sol",
      engine: "Codex",
      folder: "web",
      at: new Date("2026-11-11T18:30:00Z"),
    });
    expect(note).toContain("## Done\nThe form.");
    expect(note).toContain("From Sol on Codex · in web · 2026-11-11 18:30");
  });

  it("doesn't name the engine twice when the agent is named after it", () => {
    const note = pickUpMarkdown("Done.", {
      agentName: "Codex",
      engine: "Codex",
      folder: "",
      at: new Date("2026-11-11T18:30:00Z"),
    });
    expect(note).toContain("From Codex · 2026-11-11 18:30");
  });

  it("asks the next agent to carry on from the note", () => {
    const request = pickUpRequest("Login", "## Next step\nTests.");
    expect(request.startsWith("Pick up this work where the last agent left off: Login.")).toBe(
      true,
    );
    expect(request).toContain("## Next step\nTests.");
  });
});
