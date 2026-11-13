import { describe, expect, it } from "vitest";
import { applyTrigger, filterItems, mentionOf, triggerAt } from "./composerTriggers";

describe("triggerAt", () => {
  it("opens files, commands and skills at the caret", () => {
    expect(triggerAt("look at @src/ap", 15)).toEqual({
      kind: "file",
      query: "src/ap",
      start: 8,
      end: 15,
    });
    expect(triggerAt("/rev", 4)).toEqual({ kind: "command", query: "rev", start: 0, end: 4 });
    expect(triggerAt("use $pd", 7)).toEqual({ kind: "skill", query: "pd", start: 4, end: 7 });
    expect(triggerAt("first line\n/co", 14)?.kind).toBe("command");
    expect(triggerAt("!rev", 4)).toEqual({ kind: "prompt", query: "rev", start: 0, end: 4 });
    expect(triggerAt("then !pl", 8)).toEqual({ kind: "prompt", query: "pl", start: 5, end: 8 });
  });

  it("keeps an exclamation inside a word as text", () => {
    expect(triggerAt("Hello!", 6)).toBeUndefined();
    expect(triggerAt("wow!!", 5)).toBeUndefined();
    expect(triggerAt("! ", 2)).toBeUndefined();
  });

  it("stays closed mid-word, after a space, and for a slash inside a sentence", () => {
    expect(triggerAt("mail me@example", 15)).toBeUndefined();
    expect(triggerAt("@src ", 5)).toBeUndefined();
    expect(triggerAt("half and/or", 11)).toBeUndefined();
    expect(triggerAt("run /review", 11)).toBeUndefined();
  });
});

it("replaces the trigger with the chosen item", () => {
  const trigger = triggerAt("see @ma and more", 7)!;
  expect(applyTrigger("see @ma and more", trigger, "@src/main.ts ")).toEqual({
    text: "see @src/main.ts  and more",
    caret: 17,
  });
});

it("filters by every word and puts names that start with the query first", () => {
  const items = [{ name: "git:review" }, { name: "review" }, { name: "compact" }];
  expect(filterItems(items, "rev").map((item) => item.name)).toEqual(["review", "git:review"]);
  expect(filterItems(items, "").length).toBe(3);
});

it("quotes a mention with spaces", () => {
  expect(mentionOf("a b.md")).toBe('@"a b.md" ');
  expect(mentionOf("ab.md")).toBe("@ab.md ");
});
