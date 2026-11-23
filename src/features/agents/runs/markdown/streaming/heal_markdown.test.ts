import { describe, expect, it } from "vitest";
import { healMarkdown } from "./heal_markdown";

describe("healMarkdown", () => {
  it("closes emphasis, code and strikethrough left open at the end", () => {
    expect(healMarkdown("Some **bold")).toBe("Some **bold**");
    expect(healMarkdown("Some *it")).toBe("Some *it*");
    expect(healMarkdown("Run `npm te")).toBe("Run `npm te`");
    expect(healMarkdown("Was ~~gone")).toBe("Was ~~gone~~");
    expect(healMarkdown("Some **bold*")).toBe("Some **bold**");
  });

  it("drops a marker or tag that has nothing after it yet", () => {
    expect(healMarkdown("Next **")).toBe("Next ");
    expect(healMarkdown("See <det")).toBe("See ");
  });

  it("shows a half-written link as its text", () => {
    expect(healMarkdown("Open [the docs](https://exa")).toBe("Open the docs");
    expect(healMarkdown("Open [the do")).toBe("Open the do");
  });

  it("leaves finished text, lists, arithmetic and open fences alone", () => {
    expect(healMarkdown("Done **here**.")).toBe("Done **here**.");
    expect(healMarkdown("* one\n* two")).toBe("* one\n* two");
    expect(healMarkdown("2 * 3 is 6")).toBe("2 * 3 is 6");
    expect(healMarkdown("```ts\nconst a = **b")).toBe("```ts\nconst a = **b");
  });

  it("only looks at the last paragraph", () => {
    expect(healMarkdown("A *b* c\n\nNow **d")).toBe("A *b* c\n\nNow **d**");
  });
});
