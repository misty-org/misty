import { describe, expect, it } from "vitest";
import { doingOf, stepsOf } from "./doing";

const run = (...tools: (string | undefined)[]) => ({
  events: tools.map((toolName) => (toolName ? { toolName } : { type: "text" })),
});

describe("what an agent is doing", () => {
  it("names the latest tool in plain words", () => {
    expect(doingOf(run("web.search", undefined))).toEqual({
      words: "Searching the web",
      code: "web",
    });
    expect(doingOf(run("something.else"))).toEqual({ words: "Working", code: "working" });
    expect(doingOf(run())).toEqual({ words: "Thinking", code: "thinking" });
    expect(doingOf({ events: [{ tool_name: "agent.ask" }] }).code).toBe("agents");
  });

  it("lists the last few steps newest first, counting a repeated kind of step once", () => {
    const steps = stepsOf(
      run("web.search", "web.open", "Read", "Edit", undefined, "Bash", "browser.click"),
    );
    expect(steps).toEqual([
      "On a web page",
      "Running a command",
      "Working with files",
      "Searching the web",
    ]);
    expect(stepsOf(run("Bash", "Read", "Bash"), 2)).toEqual([
      "Running a command",
      "Working with files",
    ]);
    expect(stepsOf(run())).toEqual([]);
  });
});
