import { redactRecord, redactText, redactedError } from "@/services/telemetry/redaction";
import { describe, expect, it } from "vitest";

describe("telemetry redaction", () => {
  it("removes paths, tokens, email addresses, and sensitive keys", () => {
    const result = redactRecord({
      operation: "opening /Users/alice/private.txt",
      access_token: "abcdefghijklmnopqrstuvwxyz123456", // gitleaks:allow -- synthetic redaction fixture
      nested: { email: "alice@example.com" },
    });
    expect(JSON.stringify(result)).not.toContain("alice");
    expect(JSON.stringify(result)).not.toContain("private.txt");
    expect(JSON.stringify(result)).not.toContain("abcdefghijklmnopqrstuvwxyz");
  });

  it("redacts error messages and stacks", () => {
    const error = new Error("failed at /home/alice/report.pdf with abcdefghijklmnopqrstuvwxyz");
    const safe = redactedError(error);
    expect(safe.message).toContain("[REDACTED_PATH]");
    expect(`${safe.stack}`).not.toContain("report.pdf");
  });

  it("redacts bearer-style secrets", () => {
    expect(redactText("Bearer abcdefghijklmnopqrstuvwxyz")).not.toContain(
      "abcdefghijklmnopqrstuvwxyz",
    );
  });

  it("removes user URLs and filenames while preserving safe bundle frames", () => {
    expect(
      redactText("failed report.pdf at https://example.com/customer/alice?q=secret"),
    ).not.toMatch(/report|example|alice|secret/);
    const error = new Error("failure");
    error.stack =
      "Error: failure\n at run (https://tauri.localhost/assets/App.js?token=secret:1:2)";
    const safe = redactedError(error);
    expect(safe.stack).toContain("https://tauri.localhost/assets/App.js");
    expect(safe.stack).not.toContain("token=secret");
  });
});
