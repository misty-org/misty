import { describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => ({ apiRequest: vi.fn() }));
vi.mock("@/api/runtime/device-embeddings", () => ({
  embedOnDevice: vi.fn(),
  queryVector: vi.fn(),
}));

import { parseOverview } from "./tutorPrompts";
import { cosine, hashOf, passagesOf } from "./tutorSearch";
import { guideMarkdown, notebookMarkdown } from "./tutorShare";
import type { Guide, Notebook } from "./tutorTypes";

describe("audio overviews", () => {
  it("reads a two-speaker script, B for the second voice and A for anything else", () => {
    const reply =
      "```json\n" +
      JSON.stringify({
        title: "Cells",
        lines: [
          { speaker: "A", text: "Welcome." },
          { speaker: "b", text: "Hi!" },
          { speaker: "C", text: "Who?" },
          { speaker: "A", text: "" },
        ],
      }) +
      "\n```";
    expect(parseOverview(reply)).toEqual({
      title: "Cells",
      lines: [
        { speaker: 0, text: "Welcome." },
        { speaker: 1, text: "Hi!" },
        { speaker: 0, text: "Who?" },
      ],
    });
  });

  it("wants at least two lines", () => {
    expect(parseOverview('{"lines":[{"speaker":"A","text":"Alone."}]}')).toBeNull();
  });
});

describe("search passages", () => {
  it("cuts long text into overlapping passages that cover all of it", () => {
    const text = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} is here.`).join(" ");
    const passages = passagesOf(text);
    expect(passages.length).toBeGreaterThan(1);
    expect(passages.every((passage) => passage.length <= 1200)).toBe(true);
    expect(passages[0].startsWith("Sentence number 0")).toBe(true);
    expect(passages[passages.length - 1].endsWith("Sentence number 59 is here.")).toBe(true);
  });

  it("keeps short text whole and drops empty text", () => {
    expect(passagesOf("  Short.  ")).toEqual(["Short."]);
    expect(passagesOf("   ")).toEqual([]);
  });

  it("fingerprints text so a changed passage is embedded again", () => {
    expect(hashOf("a passage")).toBe(hashOf("a passage"));
    expect(hashOf("a passage")).not.toBe(hashOf("a passage."));
  });

  it("ranks by cosine similarity", () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });
});

describe("sharing to a Space", () => {
  const notebook: Notebook = {
    id: "n",
    title: "Biology",
    sources: [
      {
        id: "a",
        kind: "link",
        title: "Wiki",
        url: "https://example.org",
        context: "full",
        createdAt: "",
      },
      { id: "b", kind: "file", title: "paper.pdf", text: "…", context: "full", createdAt: "" },
    ],
    notes: [
      {
        id: "x",
        title: "Key points",
        body: "- cells",
        origin: "agent",
        createdAt: "",
        updatedAt: "",
      },
    ],
    transformations: [],
    chats: [],
    createdAt: "",
    updatedAt: "",
  };
  const guide = (fields: Partial<Guide>): Guide => ({
    id: "g",
    kind: "guide",
    title: "Cells",
    body: "# Cells\n\nAll about cells.",
    notebookId: "n",
    createdAt: "",
    updatedAt: "",
    ...fields,
  });

  it("lists sources by name, then notes, then guides without their repeated title", () => {
    const markdown = notebookMarkdown(notebook, [guide({})]);
    expect(markdown).toContain("1. [Wiki](https://example.org)\n2. paper.pdf");
    expect(markdown).toContain("### Key points\n\n- cells");
    expect(markdown).toContain("### Cells\n\nAll about cells.");
    expect(markdown).not.toMatch(/^# Cells$/m);
  });

  it("marks a quiz's right answers and writes an overview as its script", () => {
    const quiz = guideMarkdown(
      guide({ kind: "quiz", questions: [{ question: "2+2?", choices: ["3", "4"], answer: 1 }] }),
    );
    expect(quiz).toContain("   - 3\n   - **4**");
    const overview = guideMarkdown(
      guide({
        kind: "overview",
        script: [
          { speaker: 0, text: "Hi." },
          { speaker: 1, text: "Hello." },
        ],
      }),
    );
    expect(overview).toBe("**A:** Hi.\n\n**B:** Hello.");
  });
});

describe("passages for a question", () => {
  it("cites each passage by its source's number", async () => {
    const { passagesContext } = await import("./tutorPrompts");
    const notebook: Notebook = {
      id: "n",
      title: "Long",
      sources: [
        { id: "a", kind: "text", title: "First", text: "x", context: "full", createdAt: "" },
        { id: "b", kind: "text", title: "Second", text: "y", context: "full", createdAt: "" },
      ],
      notes: [],
      transformations: [],
      chats: [],
      createdAt: "",
      updatedAt: "",
    };
    const context = passagesContext(notebook, [{ itemId: "b", text: "the part that matters" }]);
    expect(context).toContain("[2] Second\nthe part that matters");
    expect(context).not.toContain("[1] First");
  });
});

describe("citations in an answer", () => {
  it("turns [n] into a link to source n, for sources that exist", async () => {
    vi.doMock("../runs/markdown/MistyMarkdown", () => ({ MistyMarkdown: () => null }));
    const { citeLinks } = await import("./notebook/ChatPanel");
    expect(citeLinks("Cells divide [1][2], see [9] and [x](y).", 2)).toBe(
      "Cells divide [[1]](#tutor-source-1)[[2]](#tutor-source-2), see [9] and [x](y).",
    );
    expect(citeLinks("Already [1](#a).", 2)).toBe("Already [1](#a).");
  });

  it("turns LaTeX brackets into math Misty draws", async () => {
    const { mathMarkdown } = await import("./notebook/ChatPanel");
    expect(mathMarkdown(String.raw`So \[ 2H_2O \rightarrow O_2 \] and \(x\).`)).toBe(
      String.raw`So $$2H_2O \rightarrow O_2$$ and $$x$$.`,
    );
  });
});

describe("runs Misty closed under", () => {
  it("tells an interruption from a failure of the work", async () => {
    vi.doMock("../conversations/state/useMistyStore", () => ({
      useMistyStore: { getState: () => ({}) },
    }));
    const { interrupted } = await import("./tutorRuns");
    expect(interrupted("The Misty account changed. Open Misty again.")).toBe(true);
    expect(interrupted("Misty closed before this run finished.")).toBe(true);
    expect(interrupted("The reply had nothing Tutor could use.")).toBe(false);
    expect(interrupted(undefined)).toBe(false);
  });
});
