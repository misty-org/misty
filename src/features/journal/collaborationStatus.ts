export interface JournalDocumentStatus {
  type: "document_status";
  status: "saved" | "warning" | "blocked" | "error";
  code?: string;
  document_bytes: number;
  maximum_bytes: number;
}

export function parseJournalDocumentStatus(message: string): JournalDocumentStatus | null {
  try {
    const value = JSON.parse(message) as Partial<JournalDocumentStatus>;
    if (
      value.type !== "document_status" ||
      (value.status !== "saved" &&
        value.status !== "warning" &&
        value.status !== "blocked" &&
        value.status !== "error") ||
      typeof value.document_bytes !== "number" ||
      typeof value.maximum_bytes !== "number"
    ) {
      return null;
    }
    return value as JournalDocumentStatus;
  } catch {
    return null;
  }
}

export function journalDocumentStatusMessage(status: JournalDocumentStatus): string | null {
  if (status.status === "saved") return null;
  if (status.status === "warning") {
    return "This document is getting large. Remove unused content or images before continuing.";
  }
  if (status.status === "blocked") {
    return "This edit was not accepted because the document reached its safe size limit. Remove unused content and try again.";
  }
  return "Recent changes could not be saved. Keep this window open and retry after the connection recovers.";
}
