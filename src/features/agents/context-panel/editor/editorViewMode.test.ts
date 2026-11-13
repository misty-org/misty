// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { describe, expect, it } from "vitest";
import {
  canOpenInBrowser,
  canPreviewFile,
  isHtmlFile,
  isMarkdownFile,
  opensInPreview,
} from "./editorViewMode";

describe("editor view mode", () => {
  it("opens Markdown in preview", () => {
    expect(opensInPreview("README.md")).toBe(true);
    expect(canPreviewFile("README.md")).toBe(true);
    expect(isMarkdownFile("notes.markdown")).toBe(true);
  });

  it("opens HTML in the code view; rendering waits for the preview switch", () => {
    for (const name of ["index.html", "index.htm", "index.xhtml", "INDEX.HTML"]) {
      expect(opensInPreview(name)).toBe(false);
      expect(canPreviewFile(name)).toBe(true);
    }
    expect(isHtmlFile("index.html")).toBe(true);
  });

  it("leaves other files in the code view", () => {
    for (const name of ["styles.css", "main.tsx", "data.json", "Makefile", "index"]) {
      expect(opensInPreview(name)).toBe(false);
      expect(canPreviewFile(name)).toBe(false);
    }
  });

  it("doesn't treat lookalike extensions as previewable", () => {
    for (const name of ["index.htmlish", "index.html.bak", "report.html.txt", "notes.md.bak"]) {
      expect(canPreviewFile(name)).toBe(false);
    }
  });

  it("offers open in browser for HTML only", () => {
    expect(canOpenInBrowser("docs/flow.html")).toBe(true);
    expect(canOpenInBrowser("/abs/INDEX.HTM")).toBe(true);
    for (const name of ["README.md", "index.html.bak", "docs"]) {
      expect(canOpenInBrowser(name)).toBe(false);
    }
  });
});
