import { describe, expect, it } from "vitest";
import { codeTokens, csvPreview } from "./codeTokens";
import { textPreviewKind } from "./textPreviewKind";

describe("file previews", () => {
  it("picks a preview from the type or the extension", () => {
    expect(textPreviewKind("application/octet-stream", "report.html")).toBe("html");
    expect(textPreviewKind("text/markdown", "notes")).toBe("markdown");
    expect(textPreviewKind("", "sales.tsv")).toBe("csv");
    expect(textPreviewKind("", "main.go")).toBe("code");
    expect(textPreviewKind("image/png", "photo.png")).toBeNull();
  });

  it("reads quoted CSV cells and caps rows and columns", () => {
    expect(csvPreview('name,note,a,b,c\n"Lee, Dana","said ""hi""",1,2,3\n\nx,y\n', 2, 3)).toEqual([
      ["name", "note", "a"],
      ["Lee, Dana", 'said "hi"', "1"],
    ]);
  });

  it("splits code into broad token kinds without losing text", () => {
    const source = 'const answer = 42; // done\nreturn "ok"';
    const tokens = codeTokens(source);
    expect(tokens.map((token) => token.text).join("")).toBe(source);
    expect(tokens.filter((token) => token.kind === "keyword").map((token) => token.text)).toEqual([
      "const",
      "return",
    ]);
    expect(tokens.find((token) => token.kind === "comment")?.text).toBe("// done");
    expect(tokens.find((token) => token.kind === "string")?.text).toBe('"ok"');
    expect(tokens.find((token) => token.kind === "number")?.text).toBe("42");
  });
});
