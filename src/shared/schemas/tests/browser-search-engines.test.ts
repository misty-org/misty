import { describe, expect, it } from "vitest";
import engines from "../browser-search-engines.json";
import definitions from "@/features/settings/profiles/definitions.json";

const setting = (
  definitions as { id: string; enum?: string[]; legacyValues?: string[] }[]
).find((definition) => definition.id === "browser.searchEngine")!;

describe("browser search engine table", () => {
  it("lists exactly the engines the synced setting accepts", () => {
    expect(engines.map((engine) => engine.id).sort()).toEqual([...setting.enum!].sort());
  });

  it("keeps every engine reachable through the stored legacy index", () => {
    // Stored settings hold an index into legacyValues, so it may only grow.
    for (const engine of engines) expect(setting.legacyValues).toContain(engine.id);
  });

  it("gives every engine https search and suggest templates with one query slot", () => {
    for (const engine of engines) {
      for (const template of [engine.search, engine.suggest]) {
        expect(template.startsWith("https://"), engine.id).toBe(true);
        expect(template.split("%s")).toHaveLength(2);
      }
    }
  });
});
