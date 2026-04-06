import { describe, expect, it } from "vitest";
import { providerCatalog, providerNodeTemplates } from "./providers";

describe("launch provider catalog", () => {
  it("ships only the focused July launch catalog", () => {
    expect(providerCatalog.map((item) => item.id)).toEqual([
      "google",
      "slack",
      "discord",
      "notion",
    ]);
    expect(providerCatalog.some((item) => /apple|webhook|obsidian/i.test(item.id))).toBe(false);
  });

  it("generates live watch/read cards and writes only for full or meeting providers", () => {
    for (const provider of providerCatalog) {
      expect(
        providerNodeTemplates.some(
          (item) => item.providerId === provider.id && item.operation === "watch",
        ),
      ).toBe(true);
      expect(
        providerNodeTemplates.some(
          (item) => item.providerId === provider.id && item.operation === "query",
        ),
      ).toBe(true);
      expect(
        providerNodeTemplates.some(
          (item) => item.providerId === provider.id && item.operation === "write",
        ),
      ).toBe(provider.id === "slack" || provider.id === "discord");
    }
  });
});
