// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { describe, expect, it } from "vitest";
import { createRevealPlan } from "./reveal_plan";

const el = (tagName: string, children: unknown[], className?: string[]) => ({
  type: "element",
  tagName,
  properties: className ? { className } : {},
  children,
});
const text = (value: string) => ({ type: "text", value });

function root(children: unknown[]) {
  return { type: "root", children } as never;
}

const stubFile = {} as never;
const runPlan = (plan: ReturnType<typeof createRevealPlan>, tree: unknown) =>
  plan.plugin()(tree as never, stubFile);

describe("reveal plan and typeset math", () => {
  it("wraps plain text runs with stream offsets", () => {
    const plan = createRevealPlan();
    const tree = root([el("p", [text("before"), text("after")])]);
    runPlan(plan, tree);

    const paragraph = (tree as { children: { children: unknown[] }[] }).children[0];
    const [first, second] = paragraph.children as {
      tagName: string;
      properties: { dataStreamStart?: number };
    }[];
    expect(first.tagName).toBe("span");
    expect(first.properties.dataStreamStart).toBe(0);
    expect(second.properties.dataStreamStart).toBe(6);
    expect(plan.text).toBe("beforeafter");
  });

  it("leaves a typeset formula untouched", () => {
    const plan = createRevealPlan();
    const katex = el("span", [text("x^2")], ["katex"]);
    const tree = root([el("p", [text("before"), katex, text("after")])]);
    runPlan(plan, tree);

    const paragraph = (tree as { children: { children: unknown[] }[] }).children[0];
    const [, middle] = paragraph.children as {
      tagName: string;
      properties: Record<string, unknown>;
    }[];
    expect(middle.tagName).toBe("span");
    expect(middle.properties.dataStreamStart).toBeUndefined();
    expect((middle as unknown as { children: { type: string }[] }).children[0].type).toBe("text");
    expect(plan.text).toBe("beforeafter");
  });
});
