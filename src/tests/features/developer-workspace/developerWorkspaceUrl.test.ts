import { describe, expect, it } from "vitest";
import { normalizeLocalDeveloperWorkspaceUrl } from "@/features/developer-workspace";

describe("developer workspace URL", () => {
  it.each([
    ["http://127.0.0.1:3000", "http://127.0.0.1:3000/"],
    ["https://localhost:9443/ide?token=abc", "https://localhost:9443/ide?token=abc"],
  ])("accepts local IDE address %s", (input, expected) => {
    expect(normalizeLocalDeveloperWorkspaceUrl(input)).toBe(expected);
  });

  it.each([
    "https://ide.example.com",
    "file:///tmp/editor.html",
    "http://person:secret@localhost:3000",
    "not an address",
  ])("rejects unsafe IDE address %s", (input) => {
    expect(() => normalizeLocalDeveloperWorkspaceUrl(input)).toThrow();
  });
});
