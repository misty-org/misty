// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { describe, expect, it, vi } from "vitest";

vi.mock("../../runs/markdown/MistyMarkdown", () => ({ MistyMarkdown: () => null }));

import { normalizePathSegments, resolveMarkdownLinkPath } from "./MarkdownPreview";

describe("Markdown preview links", () => {
  it("resolves a relative file link next to the document", () => {
    expect(resolveMarkdownLinkPath("./docs/a.md", "/w/README.md")).toBe("/w/docs/a.md");
    expect(resolveMarkdownLinkPath("../b.png#top", "/w/docs/x.md")).toBe("/w/b.png");
    expect(resolveMarkdownLinkPath("c%20d.md", "/w/x.md")).toBe("/w/c d.md");
  });

  it("leaves URLs, anchors and folders to something else", () => {
    for (const href of [
      "https://example.com/a.md",
      "mailto:a@b.c",
      "#section",
      "./docs/",
      "file:///etc/hosts",
    ]) {
      expect(resolveMarkdownLinkPath(href, "/w/README.md")).toBeNull();
    }
  });

  it("normalizes dot segments without climbing above an absolute root", () => {
    expect(normalizePathSegments("/w/./a/../b.md")).toBe("/w/b.md");
    expect(normalizePathSegments("/../a.md")).toBe("/a.md");
    expect(normalizePathSegments("a/../../b.md")).toBe("../b.md");
  });
});
