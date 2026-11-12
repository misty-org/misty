import { describe, expect, it } from "vitest";
import {
  briefKey,
  parseBrief,
  parseMindmap,
  parseResearch,
  reportPrompt,
  slidesOf,
} from "./tutorStudio";
import type { Notebook } from "./tutorTypes";

const fenced = (value: unknown) => "```json\n" + JSON.stringify(value) + "\n```";

describe("studio replies", () => {
  it("reads a mind map, dropping nodes without labels", () => {
    const map = parseMindmap(
      fenced({
        title: "Cells",
        root: {
          label: "Cells",
          children: [{ label: "Parts", children: [{ label: "Nucleus" }, { label: "" }] }, {}],
        },
      }),
    );
    expect(map).toEqual({
      title: "Cells",
      root: { label: "Cells", children: [{ label: "Parts", children: [{ label: "Nucleus" }] }] },
    });
    expect(parseMindmap(fenced({ root: { label: "Alone" } }))).toBeNull();
  });

  it("splits slides at lines of ---", () => {
    expect(slidesOf("# Deck\n\nIntro\n\n---\n\n## Two\n- a\n---\n\n")).toEqual([
      "# Deck\n\nIntro",
      "## Two\n- a",
    ]);
  });

  it("keeps only web addresses, once each", () => {
    const found = parseResearch(
      fenced({
        sources: [
          { title: "A", url: "https://a.example/x", why: "Basics." },
          { title: "Again", url: "https://a.example/x" },
          { title: "Local", url: "file:///etc/passwd" },
          { url: "https://b.example" },
        ],
      }),
    );
    expect(found).toEqual([
      { title: "A", url: "https://a.example/x", why: "Basics." },
      { title: "b.example", url: "https://b.example/", why: "" },
    ]);
  });

  it("reads an overview with one emoji", () => {
    const brief = parseBrief(
      fenced({
        emoji: "🧬 and more",
        title: "Genetics",
        summary: "About **genes**.",
        topics: ["DNA", "", "RNA"],
        questions: ["What is DNA?"],
      }),
    );
    expect(brief).toEqual({
      emoji: "🧬",
      title: "Genetics",
      summary: "About **genes**.",
      topics: ["DNA", "RNA"],
      questions: ["What is DNA?"],
    });
    expect(parseBrief(fenced({ emoji: "x" }))).toBeNull();
  });

  it("asks for a new overview when the sources in use change", () => {
    const notebook = {
      sources: [
        { id: "a", text: "abc", context: "full" },
        { id: "b", text: "x", context: "off" },
      ],
    } as Notebook;
    const key = briefKey(notebook);
    expect(key).toBe("a:3");
    notebook.sources[1].context = "full";
    expect(briefKey(notebook)).not.toBe(key);
  });

  it("names the report it wants", () => {
    expect(reportPrompt("timeline", "WW1")).toContain("timeline");
    expect(reportPrompt("unknown", "WW1")).toContain("study guide");
  });
});

describe("forgiving JSON", () => {
  it("reads a mind map whose reply has one closing brace too many", () => {
    const reply =
      '```json\n{"title":"T","root":{"label":"R","children":[{"label":"A"},{"label":"B"}]}}}\n```';
    expect(parseMindmap(reply)?.root.children?.map((child) => child.label)).toEqual(["A", "B"]);
  });
});

describe("drawings from engines", () => {
  it("keeps an SVG but strips what could run or reach out", async () => {
    const { cleanSvg } = await import("./tutorStudio");
    const svg = cleanSvg(
      'Here: <svg viewBox="0 0 10 10" onload="alert(1)"><script>alert(2)</script>' +
        '<foreignObject><div>x</div></foreignObject><a href="https://evil.example">' +
        '<rect width="5" height="5" onclick="x()"/></a><use href="#dot"/></svg> done',
    );
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('<rect width="5" height="5"/>');
    expect(svg).toContain('href="#dot"');
    expect(svg).not.toMatch(/script|onload|onclick|foreignObject|evil\.example/);
    expect(cleanSvg("no drawing here")).toBeNull();
  });

  it("reads an infographic from its fenced block", async () => {
    const { parseInfographic } = await import("./tutorStudio");
    expect(parseInfographic("```svg\n<svg viewBox='0 0 1 1'><circle r='1'/></svg>\n```")).toContain(
      "<circle",
    );
  });

  it("reads a video's scenes, dropping the bad drawings but keeping the scene", async () => {
    const { parseVideo } = await import("./tutorStudio");
    const video = parseVideo(
      fenced({
        title: "Cells",
        scenes: [
          { heading: "One", points: ["a"], narration: "First.", svg: "<svg><rect/></svg>" },
          { heading: "Two", narration: "Second.", svg: "not svg" },
          { heading: "", narration: "No heading." },
        ],
      }),
    );
    expect(video?.title).toBe("Cells");
    expect(video?.scenes.map((scene) => scene.heading)).toEqual(["One", "Two"]);
    expect(video?.scenes[0].svg).toContain("<rect/>");
    expect(video?.scenes[1].svg).toBeUndefined();
  });
});
