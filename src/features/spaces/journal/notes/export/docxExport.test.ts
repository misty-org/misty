import JSZip from "jszip";
import { Packer } from "docx";
import { describe, expect, it } from "vitest";
import { markdownToNoteJson } from "../markdown/noteMarkdown";
import { buildNoteDocx } from "./docxExport";
import { noteMarkdownExport } from "./noteExport";

async function documentXml(title: string, markdown: string) {
  const document = await buildNoteDocx(title, markdownToNoteJson(markdown));
  const zip = await JSZip.loadAsync(await Packer.toBuffer(document));
  return {
    body: (await zip.file("word/document.xml")?.async("string")) ?? "",
    numbering: (await zip.file("word/numbering.xml")?.async("string")) ?? "",
  };
}

describe("doc export", () => {
  it("writes a Word file with the doc's structure", async () => {
    const { body, numbering } = await documentXml(
      "Launch plan",
      [
        "## Goals",
        "",
        "Ship **fast** and *well*, see [the brief](https://example.com/brief).",
        "",
        "- First",
        "- Second",
        "",
        "1. One",
        "2. Two",
        "",
        "| Name | Count |",
        "| --- | --- |",
        "| Apples | 3 |",
        "",
        "```js",
        "let x = 1;",
        "```",
        "",
        "::embed{kind=board-frame id=drw_1 part=frame_1 title=Architecture}",
      ].join("\n"),
    );
    expect(body).toContain('w:val="Title"');
    expect(body).toContain("Launch plan");
    expect(body).toContain('w:val="Heading2"');
    expect(body).toContain("Goals");
    expect(body).toMatch(/<w:b\/>[\s\S]*fast/);
    expect(body).toContain("w:hyperlink");
    expect(body).toContain("<w:numPr>");
    expect(numbering).toContain('w:val="decimal"');
    expect(body).toContain("<w:tbl>");
    expect(body).toContain("Apples");
    expect(body).toContain("Courier New");
    expect(body).toContain("[Whiteboard frame: Architecture]");
  });

  it("doesn't repeat the title when the doc opens with it", async () => {
    const { body } = await documentXml("Notes", "# Notes\n\nBody");
    expect(body).not.toContain('w:val="Title"');
    expect(body.match(/Notes/g)).toHaveLength(1);
  });

  it("writes Markdown with the title as its first heading", () => {
    const json = markdownToNoteJson("Body text\n\n::embed{kind=data-chart id=wb_1 part=c_1}");
    const markdown = noteMarkdownExport("Weekly", json);
    expect(markdown.startsWith("# Weekly\n\nBody text")).toBe(true);
    expect(markdown).toContain("::embed{kind=data-chart id=wb_1 part=c_1}");
  });
});
