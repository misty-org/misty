import { describe, expect, it } from "vitest";

import {
  buildCreatePagePayload,
  buildPropertyPatch,
  chunkBlocks,
  markdownToNotionBlocks,
  notionBlocksToMarkdown,
  notionPageTitle,
  plainText,
  richText,
  taskListToNotionBlocks,
} from "@/features/notes/connectors/notionBlocks";
import type { NotionBlock } from "@/models/interfaces/features/notes/notion";

describe("markdownToNotionBlocks", () => {
  it("maps the common markdown block set", () => {
    const blocks = markdownToNotionBlocks(
      [
        "# Title",
        "## Subtitle",
        "A paragraph.",
        "- bullet",
        "1. numbered",
        "- [x] done task",
        "- [ ] open task",
        "> quoted",
        "---",
      ].join("\n"),
    );
    expect(blocks.map((block) => block.type)).toEqual([
      "heading_1",
      "heading_2",
      "paragraph",
      "bulleted_list_item",
      "numbered_list_item",
      "to_do",
      "to_do",
      "quote",
      "divider",
    ]);
    expect(blocks[5].to_do?.checked).toBe(true);
    expect(blocks[6].to_do?.checked).toBe(false);
  });

  it("clamps deep headings to Notion's three levels", () => {
    const blocks = markdownToNotionBlocks("##### deep heading");
    expect(blocks[0].type).toBe("heading_3");
    expect(plainText(blocks[0].heading_3?.rich_text)).toBe("deep heading");
  });

  it("keeps fenced code verbatim instead of reflowing it", () => {
    const blocks = markdownToNotionBlocks("```ts\nconst a = 1;\n\nconst b = 2;\n```");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].code?.language).toBe("ts");
    expect(plainText(blocks[0].code?.rich_text)).toBe("const a = 1;\n\nconst b = 2;");
  });

  it("splits long text rather than truncating a user's words", () => {
    const blocks = markdownToNotionBlocks("x".repeat(4500));
    const chunks = blocks[0].paragraph?.rich_text ?? [];
    expect(chunks).toHaveLength(3);
    expect(chunks.map((chunk) => chunk.text.content).join("")).toHaveLength(4500);
    expect(chunks.every((chunk) => chunk.text.content.length <= 2000)).toBe(true);
  });

  it("ignores blank lines", () => {
    expect(markdownToNotionBlocks("\n\n  \n")).toEqual([]);
  });
});

describe("notionBlocksToMarkdown", () => {
  it("round-trips the common block set", () => {
    const markdown = ["# Title", "- bullet", "- [x] done", "> quoted", "---"].join("\n");
    const roundTripped = notionBlocksToMarkdown(markdownToNotionBlocks(markdown));
    expect(roundTripped).toContain("# Title");
    expect(roundTripped).toContain("- bullet");
    expect(roundTripped).toContain("- [x] done");
    expect(roundTripped).toContain("> quoted");
    expect(roundTripped).toContain("---");
  });

  it("reads Notion's own plain_text when present", () => {
    const blocks: NotionBlock[] = [
      {
        type: "paragraph",
        paragraph: {
          rich_text: [{ type: "text", text: { content: "" }, plain_text: "from Notion" }],
        },
      },
    ];
    expect(notionBlocksToMarkdown(blocks)).toBe("from Notion");
  });
});

describe("notionPageTitle", () => {
  it("reads the title property whatever it is called", () => {
    expect(
      notionPageTitle({
        id: "p1",
        properties: { Headline: { type: "title", title: richText("Ship") } },
      }),
    ).toBe("Ship");
  });

  it("falls back to Untitled rather than rendering an empty heading", () => {
    expect(notionPageTitle({ id: "p1", properties: {} })).toBe("Untitled");
    expect(
      notionPageTitle({ id: "p1", properties: { Name: { type: "title", title: richText("  ") } } }),
    ).toBe("Untitled");
  });
});

describe("buildCreatePagePayload", () => {
  it("titles a database row under the database's own title column", () => {
    const payload = buildCreatePagePayload({
      title: "Weekly sync",
      markdown: "- note",
      parentDatabaseId: "db-1",
      titlePropertyName: "Headline",
    });
    expect(payload.parent).toEqual({ database_id: "db-1" });
    expect(payload.properties.Headline.type).toBe("title");
    expect(payload.children.map((block) => block.type)).toEqual(["bulleted_list_item"]);
  });

  it("uses the page title property when the parent is a page", () => {
    const payload = buildCreatePagePayload({
      title: "Notes",
      markdown: "",
      parentPageId: "page-1",
    });
    expect(payload.parent).toEqual({ page_id: "page-1" });
    expect(payload.properties.title.type).toBe("title");
  });

  it("refuses to publish without a parent", () => {
    expect(() => buildCreatePagePayload({ title: "x", markdown: "" })).toThrow(
      /Choose a Notion page or database/,
    );
  });

  it("falls back to Untitled for a blank title", () => {
    const payload = buildCreatePagePayload({ title: "   ", markdown: "", parentPageId: "p" });
    expect(
      plainText(payload.properties.title.type === "title" ? payload.properties.title.title : []),
    ).toBe("Untitled");
  });
});

describe("buildPropertyPatch", () => {
  const schema = {
    Name: { type: "title" },
    Status: { type: "select" },
    Tags: { type: "multi_select" },
    Due: { type: "date" },
    Done: { type: "checkbox" },
    Points: { type: "number" },
    Link: { type: "url" },
    Owner: { type: "people" },
    Rollup: { type: "rollup" },
  };

  it("shapes every simple type Misty supports", () => {
    const { properties, skipped } = buildPropertyPatch(schema, {
      Name: "Ship beta",
      Status: "In progress",
      Tags: ["beta", "notes"],
      Due: "2026-07-27T10:00:00.000Z",
      Done: true,
      Points: 3,
      Link: "https://example.com",
    });
    expect(skipped).toEqual([]);
    expect(properties.Status).toEqual({ type: "select", select: { name: "In progress" } });
    expect(properties.Tags).toEqual({
      type: "multi_select",
      multi_select: [{ name: "beta" }, { name: "notes" }],
    });
    expect(properties.Done).toEqual({ type: "checkbox", checkbox: true });
    expect(properties.Points).toEqual({ type: "number", number: 3 });
  });

  it("skips types it cannot express rather than guessing at them", () => {
    const { properties, skipped } = buildPropertyPatch(schema, {
      Owner: "someone",
      Rollup: "value",
    });
    expect(properties).toEqual({});
    expect(skipped).toEqual(["Owner", "Rollup"]);
  });

  it("skips properties the schema does not declare", () => {
    const { skipped } = buildPropertyPatch(schema, { Nonexistent: "x" });
    expect(skipped).toEqual(["Nonexistent"]);
  });

  it("skips an unparseable date instead of sending a malformed value", () => {
    const { properties, skipped } = buildPropertyPatch(schema, { Due: "not a date" });
    expect(properties.Due).toBeUndefined();
    expect(skipped).toEqual(["Due"]);
  });

  it("treats a missing schema as nothing being writable", () => {
    const { properties, skipped } = buildPropertyPatch(undefined, { Name: "x" });
    expect(properties).toEqual({});
    expect(skipped).toEqual(["Name"]);
  });
});

describe("taskListToNotionBlocks", () => {
  it("renders a Misty task list as checkable Notion to-dos", () => {
    const blocks = taskListToNotionBlocks([
      { title: "Write spec", done: true },
      { title: "Review copy", done: false },
    ]);
    expect(blocks.map((block) => block.to_do?.checked)).toEqual([true, false]);
    expect(plainText(blocks[0].to_do?.rich_text)).toBe("Write spec");
  });
});

describe("chunkBlocks", () => {
  it("splits an append into Notion-sized batches", () => {
    const blocks = markdownToNotionBlocks(
      Array.from({ length: 250 }, (_, index) => `- item ${index}`).join("\n"),
    );
    const batches = chunkBlocks(blocks);
    expect(batches.map((batch) => batch.length)).toEqual([100, 100, 50]);
  });

  it("returns nothing for an empty document", () => {
    expect(chunkBlocks([])).toEqual([]);
  });
});

describe("richText", () => {
  it("returns no spans for empty content, which Notion requires", () => {
    expect(richText("")).toEqual([]);
  });
});
