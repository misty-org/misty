// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { splitMarkdown, type MarkdownChunk } from "./markdownChunks";

const para = (label: string, width = 120) => `${label} ${"w".repeat(width)}`;
const renderMarkdown = (text: string) =>
  renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins: [remarkGfm] }, text));
const renderChunks = (chunks: MarkdownChunk[]) =>
  chunks.map((chunk) => renderMarkdown(chunk.text)).join("");
const countElements = (html: string, tag: string) =>
  html.match(new RegExp(`<${tag}(?: |>)`, "g"))?.length ?? 0;

describe("splitMarkdown", () => {
  it("splits top-level blocks and reproduces the source exactly", () => {
    const blocks = Array.from({ length: 12 }, (_, i) => para(`Block ${i}`));
    const text = blocks.join("\n\n");
    const chunks = splitMarkdown(text, 300);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((chunk) => chunk.text).join("")).toBe(text);
    expect(chunks[0].start).toBe(0);
    for (let i = 1; i < chunks.length; i += 1) {
      expect(chunks[i].start).toBe(chunks[i - 1].start + chunks[i - 1].text.length);
    }
  });

  it("keeps fenced code, display math, lists and quotes in one chunk", () => {
    const body = [
      para("Opening"),
      "```ts",
      para("A blank line inside a code block is no boundary"),
      "",
      para("Still inside the code block"),
      "```",
      "$$",
      "a + b",
      "",
      "c + d",
      "$$",
      "- Item one",
      "",
      "  Item one continued",
      "- Item two",
      "",
      "> Quote, first paragraph",
      "",
      "> Quote, second paragraph",
      para("Ending"),
    ].join("\n");
    const chunks = splitMarkdown(`${para("Preface", 20)}\n\n${body}`, 120);

    expect(chunks.map((chunk) => chunk.text).join("")).toBe(`${para("Preface", 20)}\n\n${body}`);
    const code = chunks.find((chunk) => chunk.text.includes("```ts"));
    expect(code?.text).toContain("Still inside the code block");
    const math = chunks.find((chunk) => chunk.text.includes("$$"));
    expect(math?.text).toContain("c + d");
    const quote = chunks.find((chunk) => chunk.text.includes("> Quote, first paragraph"));
    expect(quote?.text).toContain("> Quote, second paragraph");
  });

  it("keeps documents with reference or footnote definitions in one tree", () => {
    const references = `${para("Body", 500)}\n\n[docs]: https://example.com\n\n${para("Ending", 500)}`;
    expect(splitMarkdown(references, 200)).toHaveLength(1);

    const footnotes = `${para("Body", 500)}\n\n[^1]: Footnote text\n\n${para("Ending", 500)}`;
    expect(splitMarkdown(footnotes, 200)).toHaveLength(1);
  });

  it("keeps paired top-level HTML blocks intact without collapsing the whole document into one chunk", () => {
    const text = [
      para("Preface", 300),
      "<details>\n<summary>Expand</summary>\n\nParagraph one\n\nParagraph two\n</details>",
      para("Middle", 300),
      "<out>\nFirst output\n\nSecond output\n</out>",
      para("Ending", 300),
    ].join("\n\n");
    const chunks = splitMarkdown(text, 250);

    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.map((chunk) => chunk.text).join("")).toBe(text);
    const detailsChunk = chunks.find((chunk) => chunk.text.includes("<details>"));
    expect(detailsChunk?.text).toContain("</details>");
    const outChunk = chunks.find((chunk) => chunk.text.includes("<out>"));
    expect(outChunk?.text).toContain("</out>");
  });

  it("enforces a hard chunk cap on pathological unclosed lists or indented runs", () => {
    const blocks = [
      para("Opening", 200),
      `1. List start\n\n${Array.from({ length: 12 }, (_, i) => `    indentedLine${i}("${"x".repeat(80)}");`).join("\n\n")}`,
      para("Ending", 200),
    ].join("\n\n");
    const chunks = splitMarkdown(blocks, 200);

    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.map((chunk) => chunk.text).join("")).toBe(blocks);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(600);
    }
  });

  it("cuts an over-long list only before a top-level item so nested content keeps its nesting", () => {
    const items = Array.from({ length: 40 }, (_, i) =>
      [`${i + 1}. Item ${i + 1} ${"w".repeat(60)}`, `    - Sub point ${"w".repeat(30)}`].join(
        "\n\n",
      ),
    );
    const text = [para("Preface", 20), ...items, para("Ending", 20)].join("\n\n");
    const chunks = splitMarkdown(text, 600);

    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.map((chunk) => chunk.text).join("")).toBe(text);
    for (const chunk of chunks.slice(1)) {
      // A chunk opening with 4 spaces would turn the nested bullet into an
      // indented code block and drop the rest of that chunk out of the list.
      expect(chunk.text).toMatch(/^\S/);
    }
    const whole = renderMarkdown(text);
    const split = renderChunks(chunks);
    expect(countElements(split, "pre")).toBe(countElements(whole, "pre"));
    expect(countElements(split, "ul")).toBe(countElements(whole, "ul"));
    expect(countElements(split, "li")).toBe(countElements(whole, "li"));
  });

  it("does not take a backtick line whose info string has a backtick for a fence", () => {
    const text = [
      para("Preface", 300),
      "",
      "```js` is only a fence mentioned inline",
      "",
      para("Notes", 300),
      "",
      "```",
      `const a = "${"x".repeat(300)}";`,
      "",
      `const b = "${"y".repeat(300)}";`,
      "```",
      "",
      para("Ending", 300),
    ].join("\n");
    const chunks = splitMarkdown(text, 250);

    expect(chunks.map((chunk) => chunk.text).join("")).toBe(text);
    const code = chunks.find((chunk) => chunk.text.includes("const a"));
    expect(code?.text).toContain("const b");
    expect(countElements(renderChunks(chunks), "pre")).toBe(1);
  });

  it("ignores display-math dollars quoted inside inline code", () => {
    const blocks = [
      "Display math is wrapped in `$$`",
      ...Array.from({ length: 12 }, (_, i) => para(`Block ${i}`)),
    ];
    const text = blocks.join("\n\n");
    const chunks = splitMarkdown(text, 300);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((chunk) => chunk.text).join("")).toBe(text);
  });

  it("keeps a list together across a nested fenced code block", () => {
    const text = [
      para("Preface", 300),
      `1. ${"a".repeat(260)}`,
      "   ```js\n   x\n   ```",
      "1. second",
      para("Ending", 300),
    ].join("\n\n");
    const chunks = splitMarkdown(text, 250);

    expect(countElements(renderMarkdown(text), "ol")).toBe(1);
    expect(countElements(renderChunks(chunks), "ol")).toBe(1);
    expect(countElements(renderChunks(chunks), "li")).toBe(2);
  });

  it("keeps escaped reference labels and their links in one Markdown tree", () => {
    const text = [
      String.raw`[a\]]: https://example.com`,
      para("Notes", 300),
      String.raw`[a\]]`,
      para("Ending", 300),
    ].join("\n\n");
    const chunks = splitMarkdown(text, 250);

    expect(renderMarkdown(text)).toContain('<a href="https://example.com">a]</a>');
    expect(chunks).toHaveLength(1);
    expect(renderChunks(chunks)).toContain('<a href="https://example.com">a]</a>');
  });

  it("ignores HTML and definition examples inside fenced code", () => {
    const text = [
      para("Plain code", 300),
      "```md",
      "<details>",
      "[example]: https://example.com",
      "[^note]: footnote",
      "</details>",
      "```",
      para("What follows", 300),
      para("Ending", 300),
    ].join("\n\n");
    const chunks = splitMarkdown(text, 250);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((chunk) => chunk.text).join("")).toBe(text);
    expect(renderChunks(chunks)).toContain("&lt;details&gt;");
  });

  it("leaves short documents as a single chunk", () => {
    expect(splitMarkdown("Short message")).toEqual([{ text: "Short message", start: 0 }]);
    expect(splitMarkdown("")).toEqual([]);
  });
});
