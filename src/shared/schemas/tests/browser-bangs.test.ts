import { describe, expect, it } from "vitest";
import sites from "../browser-bangs.json";
import { bangNames, builtInWebBangs, mistyBangs } from "@/features/browser-workspace/bangs/catalog";

describe("browser bang table", () => {
  it("gives every site https search and home addresses with one query slot", () => {
    for (const site of sites) {
      expect(site.search.startsWith("https://"), site.trigger).toBe(true);
      expect(site.home.startsWith("https://"), site.trigger).toBe(true);
      expect(site.search.split("%s"), site.trigger).toHaveLength(2);
    }
  });

  it("never gives two shortcuts the same name", () => {
    const names = [...mistyBangs, ...builtInWebBangs].flatMap(bangNames);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^[a-z0-9][a-z0-9.-]*$/);
  });
});
