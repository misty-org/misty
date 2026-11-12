import { describe, expect, it } from "vitest";
import type { Actor } from "./behaviour";
import { screenFor, screenOf } from "./DeskScreen";

const actor = (more: Partial<Actor>): Actor => ({
  id: "ada",
  name: "Ada",
  owner: "",
  guest: false,
  state: "resting",
  doing: "",
  doingCode: "",
  ...more,
});

describe("desk screens", () => {
  it("puts up the kind of work being done", () => {
    expect(screenFor("shell")).toBe("terminal");
    expect(screenFor("browser")).toBe("browser");
    expect(screenFor("web")).toBe("browser");
    expect(screenFor("files")).toBe("files");
    expect(screenFor("space")).toBe("notes");
    expect(screenFor("thinking")).toBe("thinking");
    expect(screenFor("something new")).toBe("thinking");
  });

  it("shows waiting, how a run ended, or nothing", () => {
    expect(screenOf(actor({ state: "working", doingCode: "shell" }))).toBe("terminal");
    expect(screenOf(actor({ state: "needs-you" }))).toBe("waiting");
    expect(screenOf(actor({ outcome: "done" }))).toBe("done");
    expect(screenOf(actor({ outcome: "failed" }))).toBe("failed");
    expect(screenOf(actor({}))).toBeNull();
  });
});
