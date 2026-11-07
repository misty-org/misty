import { describe, expect, it } from "vitest";
import { emptySubtitleContext, sonioxContext, withPage, type PageContext } from "./subtitleContext";

const page: PageContext = {
  domain: "Medicine",
  topic: "A lecture on heart surgery.",
  terms: ["Ada Lovelace", "stent"],
  translationTerms: [
    { source: "stent", target: "endoprótesis" },
    { source: "bypass", target: "derivación" },
  ],
};

describe("page context", () => {
  it("is what Soniox gets when the person wrote nothing", () => {
    expect(sonioxContext(withPage(emptySubtitleContext(), page))).toEqual({
      general: [{ key: "domain", value: "Medicine" }],
      text: "A lecture on heart surgery.",
      terms: ["Ada Lovelace", "stent"],
      translation_terms: page.translationTerms,
    });
  });

  it("never overrides what the person wrote", () => {
    const merged = withPage(
      {
        ...emptySubtitleContext(),
        category: "legal",
        text: "My notes.",
        terms: ["stent", "Mine"],
        translationTerms: [{ source: "Stent", target: "mi palabra" }],
      },
      page,
    );
    expect(merged.category).toBe("legal");
    expect(merged.customCategory).toBe("");
    expect(merged.text).toBe("My notes.\nA lecture on heart surgery.");
    expect(merged.terms).toEqual(["stent", "Mine", "Ada Lovelace"]);
    expect(merged.translationTerms).toEqual([
      { source: "Stent", target: "mi palabra" },
      { source: "bypass", target: "derivación" },
    ]);
  });

  it("leaves the person's context alone without a page", () => {
    const manual = emptySubtitleContext();
    expect(withPage(manual, undefined)).toBe(manual);
  });
});
