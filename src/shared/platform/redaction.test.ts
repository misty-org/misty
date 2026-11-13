import { redactRecord, redactText } from "./redaction";
import { describe, expect, it } from "vitest";

describe("support redaction", () => {
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

  it("redacts bearer-style secrets", () => {
    expect(redactText("Bearer abcdefghijklmnopqrstuvwxyz")).not.toContain(
      "abcdefghijklmnopqrstuvwxyz",
    );
  });

  it("removes user URLs and filenames while preserving safe bundle frames", () => {
    expect(
      redactText("failed report.pdf at https://example.com/customer/alice?q=secret"),
    ).not.toMatch(/report|example|alice|secret/);
  });
});
