import { describe, expect, it } from "vitest";
import type { RunStep } from "./activityApi";
import {
  describeLive,
  describeSteps,
  fileLabel,
  offsetLabel,
  toolKey,
  tookLabel,
} from "./stepSentences";

let seq = 0;
const step = (tool: string, more: Partial<RunStep> = {}): RunStep => ({
  seq: (seq += 1),
  at: seq * 1000,
  tool,
  target: "",
  title: "",
  state: "completed",
  durationMs: 10,
  nested: false,
  picture: "",
  ...more,
});

describe("step sentences", () => {
  it("reads Misty's tools however an engine names them", () => {
    expect(toolKey("mcp__misty__browser_navigate")).toBe("browser.navigate");
    expect(toolKey("browser.fill_form")).toBe("browser.fill_form");
    expect(toolKey("Bash")).toBe("bash");
    expect(toolKey("mcp__misty__app_send")).toBe("app.send");
  });

  it("says what each engine's tools did, in plain words", () => {
    const folder = "/Users/me/repo";
    const { steps } = describeSteps(
      [
        step("Read", { target: "/Users/me/repo/src/app.ts" }),
        step("Edit", { target: "/Users/me/repo/src/app.ts" }),
        step("Bash"),
        step("js"),
        step("apply_patch"),
        step("WebSearch"),
        step("Task"),
        step("TodoWrite"),
        step("mcp__misty__note_create"),
        step("mcp__misty__app_run"),
        step("mcp__misty__browser_navigate", { target: "https://www.github.com/x", title: "" }),
      ],
      { folder },
    );
    expect(steps.map((described) => described.sentence)).toEqual([
      "Read src/app.ts",
      "Edited src/app.ts",
      "Ran a command",
      "Ran some code",
      "Changed files",
      "Searched the web",
      "Handed part of the work to a sub-agent",
      "Updated its plan",
      "Wrote a note",
      "Used a connected app",
      "Opened github.com",
    ]);
  });

  it("keeps the page a browser step is on and folds checks and repeats into one step", () => {
    const { steps } = describeSteps([
      step("browser.navigate", { target: "https://flights.example.com", title: "Flights" }),
      step("browser.snapshot"),
      step("browser.act", { picture: "a.jpg" }),
      step("browser.snapshot", { picture: "b.jpg" }),
      step("browser.act"),
      step("browser.act"),
      step("browser.act", { state: "failed" }),
    ]);
    expect(steps.map((described) => [described.sentence, described.seqs.length])).toEqual([
      ["Opened Flights", 2],
      ["Clicked on Flights", 4],
      ["Clicked on Flights", 1],
    ]);
    expect(steps[1]!.picture).toBe("b.jpg");
    expect(steps[2]!.failed).toBe(true);
  });

  it("hides housekeeping unless asked, and counts it", () => {
    const steps = [step("Bash"), step("BashOutput"), step("mcp__misty__agent_wait")];
    expect(describeSteps(steps).steps).toHaveLength(1);
    expect(describeSteps(steps).hiddenCount).toBe(2);
    expect(
      describeSteps(steps, { includeHidden: true }).steps.map((described) => described.hidden),
    ).toEqual([false, true, true]);
  });

  it("says what a running step is doing now", () => {
    expect(describeLive(undefined)).toBe("Getting started");
    expect(describeLive(step("browser.navigate", { state: "running", title: "Docs" }))).toBe(
      "Opening Docs",
    );
    expect(describeLive(step("Bash", { state: "running" }))).toBe("Running a command");
    expect(describeLive(step("AskUserQuestion", { state: "running" }))).toBe("Waiting for you");
    expect(describeLive(step("Bash"))).toBe("Thinking");
  });

  it("names files and times briefly", () => {
    expect(fileLabel("/elsewhere/deep/name.md", "/Users/me/repo")).toBe("name.md");
    expect(fileLabel("src/a.ts")).toBe("src/a.ts");
    expect(offsetLabel(62_000, 0)).toBe("1:02");
    expect(offsetLabel(3_725_000, 0)).toBe("1:02:05");
    expect(tookLabel(400)).toBe("1s");
    expect(tookLabel(150_000)).toBe("3 min");
    expect(tookLabel(3_900_000)).toBe("1 h 5 min");
  });
});
