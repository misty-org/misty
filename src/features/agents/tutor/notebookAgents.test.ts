import { describe, expect, it, vi } from "vitest";
import type { TutorJob } from "./tutorTypes";

vi.mock("../personal/personalAgentsStore", () => ({ usePersonalAgentsStore: vi.fn() }));
vi.mock("./notebookLive", () => ({ useLiveNotebook: vi.fn() }));
vi.mock("./notebookPresence", () => ({ setPresence: vi.fn() }));
vi.mock("./tutorStore", () => ({ useTutorStore: vi.fn() }));

const { agentLabel, agentsAtWork, paneOf, workWords } = await import("./notebookAgents");

const job = (id: string, change: Partial<TutorJob>): TutorJob => ({
  id,
  kind: "deck",
  title: "Flashcards: Volcanoes",
  agentId: "a1",
  prompt: "Make it",
  notebookId: "n1",
  state: "running",
  createdAt: `2026-11-01T00:00:0${id.slice(-1)}Z`,
  updatedAt: "2026-11-01T00:00:00Z",
  ...change,
});

const profiles = [
  { id: "a1", name: "Nova", engine: "claude", avatar: { emoji: "🦊" } },
  { id: "a2", name: "Sage", engine: "codex", avatar: {} },
];

describe("agents at work in a notebook", () => {
  it("lists each agent once, by what it started first, in this notebook only", () => {
    const working = agentsAtWork(
      [
        job("j2", { kind: "quiz" }),
        job("j1", { kind: "summary", agentId: "a1", sourceId: "s1" }),
        job("j3", { kind: "research", agentId: "a2" }),
        job("j4", { kind: "deck", agentId: "a3", notebookId: "n2" }),
        job("j5", { kind: "deck", agentId: "a3", state: "done" }),
      ],
      "n1",
      profiles,
    );
    expect(working).toEqual([
      {
        agentId: "a1",
        name: "Nova",
        engine: "claude",
        emoji: "🦊",
        work: "summarizing",
        kind: undefined,
        item: "s1",
      },
      {
        agentId: "a2",
        name: "Sage",
        engine: "codex",
        emoji: undefined,
        work: "finding",
        kind: undefined,
        item: undefined,
      },
    ]);
  });

  it("says what a making run makes, and names an agent it doesn't know", () => {
    const [working] = agentsAtWork([job("j1", { kind: "mindmap", agentId: "gone" })], "n1", []);
    expect(working).toMatchObject({ name: "Agent", work: "making", kind: "mindmap" });
    expect(workWords(working)).toBe("is making a mind map");
    expect(workWords({ work: "making" })).toBe("is making something");
  });

  it("puts each kind of work in its pane", () => {
    expect(paneOf("finding")).toBe("sources");
    expect(paneOf("summarizing")).toBe("sources");
    expect(paneOf("making")).toBe("studio");
    expect(paneOf("overview")).toBeUndefined();
    expect(paneOf("note")).toBeUndefined();
  });

  it("says the work in a few words", () => {
    expect(workWords({ work: "finding" })).toBe("is finding sources");
    expect(workWords({ work: "overview" })).toBe("is writing the overview");
    expect(workWords({ work: "summarizing" })).toBe("is summarizing a source");
    expect(workWords({ work: "note" })).toBe("is writing a note");
    expect(workWords({ work: "making", kind: "video" })).toBe("is making a video overview");
  });

  it("names a teammate's agent with whose it is", () => {
    expect(agentLabel({ name: "Nova", ownerName: "You", mine: true })).toBe("Nova");
    expect(agentLabel({ name: "Nova", ownerName: "Sam", mine: false })).toBe("Sam's Nova");
  });
});
