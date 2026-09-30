import { describe, expect, it } from "vitest";
import type { AiProgressItem } from "@/features/ai-surface/types";
import {
  groupProgress,
  stepMeta,
  stepsOf,
  toolGroupSummary,
  toolLabel,
  withToolEvent,
} from "./progressTimeline";

describe("progress timeline", () => {
  it("turns text before a tool into a note and tracks the tool", () => {
    let message: { content: string; progress?: AiProgressItem[] } = {
      content: "Let me check your tabs.",
    };
    const started = withToolEvent(message, {
      id: "1",
      type: "tool.started",
      toolCallId: "a",
      toolName: "browser.tab.list",
    });
    expect(started).toEqual({
      content: "",
      progress: [
        { type: "note", text: "Let me check your tabs." },
        { type: "tool", id: "a", name: "browser.tab.list", state: "running" },
      ],
    });
    message = started;
    expect(
      withToolEvent(message, {
        id: "2",
        type: "tool.failed",
        toolCallId: "a",
        toolName: "browser.tab.list",
        error: "Tabs were unavailable.",
      }).progress[1],
    ).toMatchObject({ state: "failed", error: "Tabs were unavailable." });
    expect(
      withToolEvent(message, {
        id: "3",
        type: "tool.detail",
        toolCallId: "a",
        toolName: "browser.tab.list",
        activity: { result: "4 results" },
      }).progress[1],
    ).toMatchObject({ activity: { result: "4 results" } });
  });

  it("folds consecutive tools into one group", () => {
    const groups = groupProgress([
      { type: "tool", id: "a", name: "browser.tab.list", state: "completed" },
      { type: "tool", id: "b", name: "browser.read", state: "failed" },
      { type: "note", text: "Found it." },
      { type: "tool", id: "c", name: "note.search", state: "running" },
    ]);
    expect(groups.map((group) => group.type)).toEqual(["tools", "note", "tools"]);
    expect(toolGroupSummary(groups[0].type === "tools" ? groups[0].tools : [])).toBe(
      "Listed tabs, read browser",
    );
    expect(toolGroupSummary(groups[2].type === "tools" ? groups[2].tools : [])).toBe(
      "Searching notes",
    );
  });

  it("folds a failed try into the step that followed it", () => {
    const steps = stepsOf([
      { type: "tool", id: "a", name: "web.search", state: "failed", activity: { detail: "eggs" } },
      {
        type: "tool",
        id: "b",
        name: "web.search",
        state: "completed",
        activity: { detail: "eggs" },
      },
      {
        type: "tool",
        id: "c",
        name: "web.search",
        state: "completed",
        activity: { detail: "tofu" },
      },
    ]);
    expect(steps.map((step) => [step.id, step.attempts])).toEqual([
      ["b", 2],
      ["c", 1],
    ]);
    expect(stepMeta(steps[0])).toBe("Tried 2×");
  });

  it("names code project tools as whole phrases", () => {
    expect(toolLabel("code.run", true)).toBe("Running a command");
    expect(toolLabel("code_edit", false)).toBe("Edited a file");
    expect(toolLabel("code_preview", false)).toBe("Opened a preview");
    expect(toolLabel("git_commit", false)).toBe("Committed changes");
    expect(toolLabel("git.push", true)).toBe("Pushing to GitHub");
    expect(toolLabel("git_pull_request", false)).toBe("Opened a pull request");
  });

  it("names tools in plain words", () => {
    expect(toolLabel("browser.tab.list", false)).toBe("Listed tabs");
    expect(toolLabel("misty_notes_search", true)).toBe("Searching notes");
    expect(toolLabel("event.query", false)).toBe("Checked calendar");
    expect(toolLabel("weather.forecast", false)).toBe("Used weather forecast");
    expect(toolLabel("agent.finish", false)).toBe("Wrapped up");
  });
});
