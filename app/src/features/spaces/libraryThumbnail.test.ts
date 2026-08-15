import { libraryItemThumbnailEligible } from "@/features/spaces/library/libraryThumbnail";
import { describe, expect, it } from "vitest";

describe("libraryItemThumbnailEligible", () => {
  it("requests thumbnails for PDFs and common documents", () => {
    expect(libraryItemThumbnailEligible("application/pdf", "Interview Synthesis.pdf")).toBe(true);
    expect(libraryItemThumbnailEligible("application/octet-stream", "Research Brief.docx")).toBe(
      true,
    );
    expect(libraryItemThumbnailEligible("text/markdown", "notes.md")).toBe(true);
  });

  it("leaves unusual binary files on the generic-file fallback", () => {
    expect(libraryItemThumbnailEligible("application/octet-stream", "payload.weirdbin")).toBe(
      false,
    );
  });
});
