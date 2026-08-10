import { describe, expect, it } from "vitest";

import {
  UPLOAD_LIMIT_BYTES,
  formatUploadLimit,
  uploadLimitError,
} from "@/services/spaces/upload-limits";

const MB = 1024 * 1024;

describe("upload limits", () => {
  it("uses the beta per-purpose maximums", () => {
    expect(UPLOAD_LIMIT_BYTES.library).toBe(100 * MB);
    expect(UPLOAD_LIMIT_BYTES.note_attachment).toBe(15 * MB);
    expect(UPLOAD_LIMIT_BYTES.attachment).toBe(10 * MB);
  });

  it("accepts a file exactly at the limit", () => {
    expect(uploadLimitError("library", 100 * MB)).toBeNull();
    expect(uploadLimitError("note_attachment", 15 * MB)).toBeNull();
    expect(uploadLimitError("attachment", 10 * MB)).toBeNull();
  });

  it("rejects a file one byte over the limit", () => {
    expect(uploadLimitError("library", 100 * MB + 1)).toContain("100 MB");
    expect(uploadLimitError("note_attachment", 15 * MB + 1)).toContain("15 MB");
    expect(uploadLimitError("attachment", 10 * MB + 1)).toContain("10 MB");
  });

  it("names the surface in the error so the user knows which limit applies", () => {
    expect(uploadLimitError("attachment", 20 * MB)).toContain("Chat attachment");
    expect(uploadLimitError("note_attachment", 20 * MB)).toContain("Note attachment");
    expect(uploadLimitError("library", 200 * MB)).toContain("Library file");
  });

  it("formats limits in whole megabytes", () => {
    expect(formatUploadLimit("library")).toBe("100 MB");
    expect(formatUploadLimit("attachment")).toBe("10 MB");
  });
});
