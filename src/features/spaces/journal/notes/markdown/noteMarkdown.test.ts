import type { JSONContent } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { markdownToNoteJson, noteJsonToMarkdown, noteJsonToPlainText } from "./noteMarkdown";

function find(json: JSONContent, type: string): JSONContent | undefined {
  if (json.type === type) return json;
  for (const child of json.content ?? []) {
    const found = find(child, type);
    if (found) return found;
  }
  return undefined;
}

describe("doc markdown", () => {
  it("turns an embed directive into an embed node and back", () => {
    const markdown = [
      "Before",
      "",
      '::embed{kind=data-range id=wb_1 part="sheet_1!{r:a,c:b}:{r:c,c:d}" title="Q3"}',
      "",
      "After",
    ].join("\n");
    const json = markdownToNoteJson(markdown);
    expect(find(json, "mistyEmbed")?.attrs).toMatchObject({
      kind: "data-range",
      itemId: "wb_1",
      partId: "sheet_1!{r:a,c:b}:{r:c,c:d}",
      title: "Q3",
    });
    const back = noteJsonToMarkdown(json);
    expect(back).toContain(
      '::embed{kind=data-range id=wb_1 part="sheet_1!{r:a,c:b}:{r:c,c:d}" title=Q3}',
    );
    expect(back).toContain("Before");
    expect(back).toContain("After");
    // Twice through gives the same text.
    expect(noteJsonToMarkdown(markdownToNoteJson(back))).toBe(back);
  });

  it("keeps a directive that names nothing valid as text", () => {
    const json = markdownToNoteJson("::embed{kind=nope id=a part=b}");
    expect(find(json, "mistyEmbed")).toBeUndefined();
    expect(noteJsonToPlainText(json)).toContain("::embed");
  });

  it("reads and writes tables", () => {
    const markdown = ["| Name | Count |", "| --- | --- |", "| Apples | 3 |", "| Pears | 5 |"].join(
      "\n",
    );
    const json = markdownToNoteJson(markdown);
    const table = find(json, "table");
    expect(table?.content).toHaveLength(3);
    expect(table?.content?.[0]?.content?.[0]?.type).toBe("tableHeader");
    expect(table?.content?.[1]?.content?.[0]?.type).toBe("tableCell");
    const back = noteJsonToMarkdown(json);
    expect(back).toMatch(/\|\s*Name\s*\|\s*Count\s*\|/);
    expect(back).toMatch(/\|\s*-{3,}/);
    expect(back).toMatch(/\|\s*Pears\s*\|\s*5\s*\|/);
  });

  it("keeps a code block's language for highlighting", () => {
    const markdown = ["```ts", "const answer = 42;", "```"].join("\n");
    const json = markdownToNoteJson(markdown);
    const code = find(json, "codeBlock");
    expect(code?.attrs?.language).toBe("ts");
    expect(code?.content?.[0]?.text).toBe("const answer = 42;");
    expect(noteJsonToMarkdown(json)).toContain("```ts\nconst answer = 42;\n```");
  });
});
