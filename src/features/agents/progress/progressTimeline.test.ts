import { describe, expect, it } from "vitest";
import type { AiProgressItem } from "@/features/ai-surface/types";
import {
  groupProgress,
  stepMeta,
  stepsOf,
  toolGroupSummary,
  toolLabel,
  withAnswer,
  withToolEvent,
} from "./progressTimeline";

describe("progress timeline", () => {
  it("shows a text answer once when the run wraps up with the same answer", () => {
    const answer = "The capital of France is Paris.";
    let message: { content: string; progress?: AiProgressItem[] } = { content: "" };
    message = withToolEvent(message, {
      id: "1",
      type: "tool.started",
      toolCallId: "a",
      toolName: "web_search",
    });
    message = withToolEvent(message, {
      id: "2",
      type: "tool.completed",
      toolCallId: "a",
      toolName: "web_search",
    });
    message = withAnswer(message, answer);
    // The finish nudge: agent_finish starts and the answer moves into a note.
    message = withToolEvent(message, {
      id: "3",
      type: "tool.started",
      toolCallId: "f",
      toolName: "agent_finish",
    });
    message = withToolEvent(message, {
      id: "4",
      type: "tool.completed",
      toolCallId: "f",
      toolName: "agent_finish",
    });
    expect(message.content).toBe("");
    // The final text is that same answer: it becomes the reply and the note goes.
    message = withAnswer(message, answer);
    expect(message.content).toBe(answer);
    const groups = groupProgress(message.progress ?? []);
    expect(groups.map((group) => group.type)).toEqual(["tools"]);
    expect(groups.some((group) => group.type === "note" && group.text === answer)).toBe(false);
    expect(toolGroupSummary(groups[0].type === "tools" ? groups[0].tools : [])).toBe(
      "Searched web, wrapped up",
    );
  });

  it("drops the note for a partial answer and keeps notes the answer does not repeat", () => {
    const progress: AiProgressItem[] = [
      { type: "note", text: "Found two of three." },
      { type: "tool", id: "f", name: "agent_finish", state: "completed" },
    ];
    expect(
      withAnswer({ progress }, "Found two of three.\n\nStill incomplete:\n- Third: no source")
        .progress,
    ).toEqual([progress[1]]);
    expect(withAnswer({ progress }, "A different summary.").progress).toEqual(progress);
    // Narration before another tool stays a note.
    const narrated: AiProgressItem[] = [
      { type: "note", text: "Let me check." },
      { type: "tool", id: "a", name: "web_search", state: "completed" },
    ];
    expect(withAnswer({ progress: narrated }, "Let me check.").progress).toEqual(narrated);
  });

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
      "Searched notes",
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
    expect(toolLabel("note.query", false)).toBe("Checked notes");
    expect(toolLabel("weather.forecast", false)).toBe("Used weather forecast");
    expect(toolLabel("agent.finish", false)).toBe("Wrapped up");
  });
});

describe("progress notes", () => {
  it("leaves pointing tags out of narration", () => {
    expect(
      groupProgress([{ type: "note", text: "i'm checking the member list. [POINT:none]" }]),
    ).toEqual([{ type: "note", key: "note:0", text: "i'm checking the member list." }]);
    expect(groupProgress([{ type: "note", text: "[POINT:none]" }])).toEqual([]);
  });
});
