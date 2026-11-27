import { describe, expect, it } from "vitest";
import type { AiProgressItem } from "@/features/agents/runs/invocations/invocation_types";
import { useRegistry } from "@/native/registry";
import {
  groupProgress,
  stepMeta,
  stepsOf,
  toolGroupSummary,
  toolLabel,
  withAnswer,
  withToolEvent,
} from "./progress_timeline";

describe("progress timeline", () => {
  it("keeps what a step acted on once its output arrives", () => {
    let message: { content: string; progress?: AiProgressItem[] } = { content: "" };
    message = withToolEvent(message, {
      id: "1",
      type: "tool.started",
      toolCallId: "a",
      toolName: "Bash",
      args: {},
    });
    message = withToolEvent(message, {
      id: "2",
      type: "tool.detail",
      toolCallId: "a",
      toolName: "Bash",
      activity: { input: { command: "npm test" }, detail: "npm test" },
    });
    message = withToolEvent(message, {
      id: "3",
      type: "tool.detail",
      toolCallId: "a",
      toolName: "Bash",
      activity: { output: "ok" },
    });
    const step = message.progress?.[0];
    expect(step).toMatchObject({
      args: { command: "npm test" },
      activity: { detail: "npm test", output: "ok" },
    });
  });

  it("takes a streamed edit's arguments and path from its details", () => {
    let message: { content: string; progress?: AiProgressItem[] } = { content: "" };
    message = withToolEvent(message, {
      id: "1",
      type: "tool.started",
      toolCallId: "a",
      toolName: "Edit",
      args: {},
    });
    message = withToolEvent(message, {
      id: "2",
      type: "tool.detail",
      toolCallId: "a",
      toolName: "Edit",
      activity: {
        input: { file_path: "src/a.ts", old_string: "a", new_string: "b" },
        detail: "src/a.ts",
      },
    });
    expect(message.progress?.[0]).toMatchObject({
      args: { file_path: "src/a.ts", old_string: "a", new_string: "b" },
      path: "src/a.ts",
    });
  });

  it("keeps a call's raw parameters and result on its row", () => {
    let message: { content: string; progress?: AiProgressItem[] } = { content: "" };
    message = withToolEvent(message, {
      id: "1",
      type: "tool.started",
      toolCallId: "a",
      toolName: "Edit",
      args: { file_path: "src/a.ts", old_string: "a", new_string: "b" },
      path: "src/a.ts",
    });
    message = withToolEvent(message, {
      id: "2",
      type: "tool.completed",
      toolCallId: "a",
      toolName: "Edit",
      result: "The file was updated.",
    });
    expect(message.progress).toEqual([
      {
        type: "tool",
        id: "a",
        name: "Edit",
        state: "completed",
        args: { file_path: "src/a.ts", old_string: "a", new_string: "b" },
        path: "src/a.ts",
        result: "The file was updated.",
        durationMs: undefined,
        error: undefined,
      },
    ]);
  });

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
      { type: "tool", id: "c", name: "message.search", state: "running" },
    ]);
    expect(groups.map((group) => group.type)).toEqual(["tools", "note", "tools"]);
    expect(toolGroupSummary(groups[0].type === "tools" ? groups[0].tools : [])).toBe(
      "Listed tabs, read browser",
    );
    expect(toolGroupSummary(groups[2].type === "tools" ? groups[2].tools : [])).toBe(
      "Searched messages",
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

  it("names tools in plain words", () => {
    expect(toolLabel("browser.tab.list", false)).toBe("Listed tabs");
    expect(toolLabel("misty_notes_search", true)).toBe("Searching notes");
    expect(toolLabel("note.query", false)).toBe("Checked notebooks");
    expect(toolLabel("file.list", false)).toBe("Listed Files");
    expect(toolLabel("weather.forecast", false)).toBe("Used weather forecast");
    expect(toolLabel("agent.finish", false)).toBe("Wrapped up");
  });

  it("names connector and app tools without their wire names", () => {
    useRegistry.setState({ apps: [{ id: "deckcraft", name: "DeckCraft" }] });
    expect(
      toolLabel("mcp__misty__app_deckcraft_execute", false, { command: "insert.picture" }),
    ).toBe("Ran insert picture in DeckCraft");
    expect(toolLabel("mcp__misty__app_deckcraft_screen_click", true)).toBe("Clicking in DeckCraft");
    expect(toolLabel("mcp__misty__app_deckcraft_inspect_document", false)).toBe(
      "Inspected document in DeckCraft",
    );
    expect(toolLabel("mcp__misty__file_create", false)).toBe("Created Files");
    expect(toolLabel("mcp__notion__search", false)).toBe("Searched in Notion");
    expect(toolLabel("mcp__claude_ai_Gmail__send_email", false)).toBe("Sent email in Gmail");
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
