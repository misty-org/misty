import { describe, expect, it } from "vitest";
import { agentNamed, mentionsIn, studioNames } from "./studioNames";

describe("studioNames", () => {
  it("keeps names that are already different", () => {
    const names = studioNames([
      { id: "a", name: "Codex" },
      { id: "b", name: "Claude Code" },
    ]);
    expect([...names.values()]).toEqual(["Codex", "Claude Code"]);
  });

  it("tells agents of one name apart by role, else by number", () => {
    const names = studioNames([
      { id: "a", name: "Oh My Pi", role: "Reviews pull requests" },
      { id: "b", name: "Oh My Pi", role: "Coding agent" },
      { id: "c", name: "Oh My Pi", role: "Coding agent" },
      { id: "d", name: "oh my pi" },
    ]);
    expect(names.get("a")).toBe("Oh My Pi · Reviews pull requests");
    expect(names.get("b")).toBe("Oh My Pi 2");
    expect(names.get("c")).toBe("Oh My Pi 3");
    expect(names.get("d")).toBe("oh my pi 4");
  });

  it("numbers the first of a repeated name plainly", () => {
    const names = studioNames([
      { id: "a", name: "Codex" },
      { id: "b", name: "Codex" },
    ]);
    expect(names.get("a")).toBe("Codex");
    expect(names.get("b")).toBe("Codex 2");
  });
});

describe("mentions", () => {
  const names = new Map([
    ["codex", "Codex"],
    ["codex2", "Codex 2"],
    ["claude", "Claude Code"],
  ]);

  it("finds the longest whole name", () => {
    expect(agentNamed(names, "Codex 2 please")).toBe("codex2");
    expect(agentNamed(names, "codex, hi")).toBe("codex");
    expect(agentNamed(names, "Codexes")).toBeNull();
  });

  it("reads every @name and leaves the message", () => {
    expect(mentionsIn(names, "@Claude Code, @codex: fix the tests")).toEqual({
      ids: ["claude", "codex"],
      message: "fix the tests",
    });
    expect(mentionsIn(names, "ask @Codex 2 about it")).toEqual({
      ids: ["codex2"],
      message: "ask about it",
    });
  });

  it("leaves addresses and unknown names alone", () => {
    expect(mentionsIn(names, "mail me@codex.dev about @nobody")).toEqual({
      ids: [],
      message: "mail me@codex.dev about @nobody",
    });
  });
});
