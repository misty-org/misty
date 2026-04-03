import { describe, expect, it } from "vitest";
import { preparedDocumentBatch } from "./attachments";
import type { PreparedAgentDocument } from "./types";

function documentWith(count: number, scanned = false): PreparedAgentDocument {
  return {
    documentId: "document_1",
    displayName: "report.pdf",
    mimeType: "application/pdf",
    sizeBytes: 100,
    truncated: false,
    requiresOcr: scanned,
    sections: Array.from({ length: count }, (_, index) => ({
      kind: "page" as const,
      locator: String(index + 1),
      text: scanned ? "" : `page ${index + 1}`,
      requiresOcr: scanned,
      imageDataUrl: scanned && index < 8 ? "data:image/jpeg;base64,YQ==" : null,
    })),
  };
}

describe("preparedDocumentBatch", () => {
  it("bounds native text batches and provides a continuation cursor", () => {
    const batch = preparedDocumentBatch(documentWith(120));
    expect(batch.document.sections).toHaveLength(50);
    expect(batch.nextCursor).toBe(50);
  });

  it("stops after the rendered OCR pages", () => {
    const batch = preparedDocumentBatch(documentWith(20, true));
    expect(batch.document.sections).toHaveLength(8);
    expect(batch.nextCursor).toBe(8);
  });
});
