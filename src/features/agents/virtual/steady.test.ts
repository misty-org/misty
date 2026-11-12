import { describe, expect, it } from "vitest";
import { LINGER_MS, steadyState } from "./steady";

const working = { state: "working" as const, doing: "Running a command", doingCode: "shell" };
const resting = { state: "resting" as const, doing: "", doingCode: "" };

describe("steadyState", () => {
  it("keeps a just-stopped agent at work for a moment, doing what it last did", () => {
    const first = steadyState(working, undefined, 0);
    const next = steadyState(resting, first.memory, LINGER_MS - 1);
    expect(next.shown).toEqual(working);
  });

  it("lets it rest once the moment has passed", () => {
    const first = steadyState(working, undefined, 0);
    const next = steadyState(resting, first.memory, LINGER_MS);
    expect(next.shown).toEqual(resting);
    expect(next.memory).toBeUndefined();
  });

  it("shows needing its person at once", () => {
    const first = steadyState(working, undefined, 0);
    const needs = { state: "needs-you" as const, doing: "Needs you", doingCode: "" };
    expect(steadyState(needs, first.memory, 10).shown).toEqual(needs);
  });

  it("never lingers an agent that hadn't worked", () => {
    expect(steadyState(resting, undefined, 0).shown).toEqual(resting);
  });
});
