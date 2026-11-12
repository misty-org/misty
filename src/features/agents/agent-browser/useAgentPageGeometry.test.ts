import { describe, expect, it } from "vitest";
import { agentPageHostShown } from "./useAgentPageGeometry";

const host = (wrapper: (outer: HTMLElement) => void) => {
  const outer = document.createElement("div");
  wrapper(outer);
  const inner = document.createElement("div");
  outer.append(inner);
  document.body.append(outer);
  return inner;
};

describe("an agent page's host", () => {
  it("is shown in the open view", () => {
    expect(agentPageHostShown(host(() => undefined))).toBe(true);
  });

  it("is not shown in a view kept beneath another, though it keeps its size", () => {
    expect(agentPageHostShown(host((outer) => outer.setAttribute("data-tab-kept", "")))).toBe(
      false,
    );
  });

  it("is not shown in a hidden part of the page", () => {
    expect(agentPageHostShown(host((outer) => (outer.hidden = true)))).toBe(false);
  });
});
