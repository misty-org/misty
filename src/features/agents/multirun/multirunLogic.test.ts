import { describe, expect, it } from "vitest";
import {
  changeTotals,
  isLaneSettled,
  laneChoices,
  laneStatus,
  laneTitle,
  maxLanes,
  readinessNotice,
  toggleChoice,
} from "./multirunLogic";

const engines = [
  { id: "claude", name: "Claude Code", installed: true },
  { id: "codex", name: "Codex", installed: false },
];

describe("laneChoices", () => {
  it("offers agents on installed outside engines and says why the others can't run", () => {
    const choices = laneChoices(
      [
        { id: "a", name: "Coder", enabled: true, engine: "claude" },
        { id: "b", name: "Misty", enabled: true },
        { id: "c", name: "Explicit", enabled: true, engine: "misty" },
        { id: "d", name: "Codex one", enabled: true, engine: "codex" },
        { id: "e", name: "Unknown", enabled: true, engine: "other" },
        { id: "f", name: "Off", enabled: false, engine: "claude" },
      ],
      engines,
    );
    expect(choices.map((choice) => [choice.agent.id, choice.reason])).toEqual([
      ["a", ""],
      ["b", "Misty's engine has no worktrees"],
      ["c", "Misty's engine has no worktrees"],
      ["d", "Codex isn't installed"],
      ["e", "Its engine has no adapter"],
    ]);
  });
});

describe("toggleChoice", () => {
  it("adds, removes, and stops at the most a multi-run takes", () => {
    expect(toggleChoice([], "a")).toEqual(["a"]);
    expect(toggleChoice(["a", "b"], "a")).toEqual(["b"]);
    const full = Array.from({ length: maxLanes }, (_, index) => `agent-${index}`);
    expect(toggleChoice(full, "one-more")).toEqual(full);
    expect(toggleChoice(full, "agent-0")).toHaveLength(maxLanes - 1);
  });
});

describe("laneStatus", () => {
  it("reads a lane's state from its chat's reply", () => {
    expect(laneStatus(undefined)).toBe("missing");
    expect(laneStatus({ state: "pending" })).toBe("working");
    expect(laneStatus({ state: "streaming" })).toBe("working");
    expect(laneStatus({ state: "pending", activity: "awaiting_approval" })).toBe("waiting");
    expect(laneStatus({ state: "completed" })).toBe("finished");
    expect(laneStatus({ state: "failed" })).toBe("failed");
    expect(laneStatus({ state: "canceled" })).toBe("stopped");
  });

  it("counts a lane as settled once nothing more will come", () => {
    expect(isLaneSettled("working")).toBe(false);
    expect(isLaneSettled("waiting")).toBe(false);
    expect(isLaneSettled("finished")).toBe(true);
    expect(isLaneSettled("failed")).toBe(true);
  });
});

describe("changeTotals", () => {
  it("adds up a lane's files and lines", () => {
    expect(changeTotals([])).toEqual({ files: 0, insertions: 0, deletions: 0 });
    expect(
      changeTotals([
        { insertions: 3, deletions: 1 },
        { insertions: 0, deletions: 4 },
      ]),
    ).toEqual({ files: 2, insertions: 3, deletions: 5 });
  });
});

describe("readinessNotice", () => {
  it("names one thing to do for each thing in the way", () => {
    expect(readinessNotice("", null)?.action).toBe("link");
    expect(readinessNotice("/work/app", "ready")).toBeNull();
    expect(readinessNotice("/work/app", null)).toBeNull();
    expect(readinessNotice("/work/app", "not_repository")?.action).toBe("link");
    expect(readinessNotice("/work/app", "not_top_level")?.action).toBe("link");
    expect(readinessNotice("/work/app", "no_commits")?.action).toBe("retry");
    expect(readinessNotice("/work/app", "no_git")?.action).toBe("retry");
  });
});

describe("laneTitle", () => {
  it("is the task's first line, cut to fit a row", () => {
    expect(laneTitle("  Fix the login bug\nand add a test")).toBe("Fix the login bug");
    expect(laneTitle("x".repeat(80))).toHaveLength(56);
  });
});
