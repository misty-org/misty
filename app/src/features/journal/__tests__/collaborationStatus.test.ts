import { describe, expect, it } from "vitest";
import { journalDocumentStatusMessage, parseJournalDocumentStatus } from "../collaborationStatus";

describe("Journal collaboration status", () => {
  it("parses persistence and document limit notices", () => {
    const status = parseJournalDocumentStatus(
      JSON.stringify({
        type: "document_status",
        status: "blocked",
        document_bytes: 9,
        maximum_bytes: 8,
      }),
    );

    expect(status?.status).toBe("blocked");
    expect(journalDocumentStatusMessage(status!)).toContain("not accepted");
  });

  it("ignores unrelated and malformed custom messages", () => {
    expect(parseJournalDocumentStatus("hello")).toBeNull();
    expect(parseJournalDocumentStatus(JSON.stringify({ type: "presence" }))).toBeNull();
  });

  it("clears a notice after a successful save", () => {
    const status = parseJournalDocumentStatus(
      JSON.stringify({
        type: "document_status",
        status: "saved",
        document_bytes: 4,
        maximum_bytes: 8,
      }),
    );

    expect(journalDocumentStatusMessage(status!)).toBeNull();
  });
});
