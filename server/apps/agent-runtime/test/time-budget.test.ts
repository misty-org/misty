import { describe, expect, it } from "vitest";
import type { ModelMessage } from "ai";
import { estimateMinutes, timeBudget } from "../src/time-budget.js";

const minutes = (value: number) => value * 60_000;
const checklist = (estimate: number): ModelMessage => ({
  role: "assistant",
  content: [{ type: "tool-call", toolCallId: "c1", toolName: "log_work_checklist", input: { items: [], minutes: estimate } }],
});

describe("timeBudget", () => {
  it("reads the agent's estimate from its checklist", () => {
    expect(estimateMinutes([])).toBeUndefined();
    expect(estimateMinutes([checklist(3), checklist(4)])).toBe(4);
  });

  it("paces a ten-minute task at eight, wraps up at ten, and allows only the answer from thirteen", () => {
    const messages: ModelMessage[] = [];
    expect(timeBudget(minutes(7), messages)).toEqual({ answerOnly: false });
    const pace = timeBudget(minutes(8), messages);
    expect(pace.note).toMatch(/^Time budget \(pace\)/);
    messages.push({ role: "user", content: pace.note! });
    expect(timeBudget(minutes(9), messages).note).toBeUndefined();
    const wrap = timeBudget(minutes(10), messages);
    expect(wrap.note).toMatch(/^Time budget \(wrap\)/);
    messages.push({ role: "user", content: wrap.note! });
    const answer = timeBudget(minutes(13), messages);
    expect(answer).toMatchObject({ answerOnly: true });
    messages.push({ role: "user", content: answer.note! });
    expect(timeBudget(minutes(14), messages)).toEqual({ answerOnly: true, note: undefined });
  });

  it("holds a three-minute lookup to about three minutes", () => {
    expect(timeBudget(minutes(2.5), [], 3).note).toMatch(/^Time budget \(pace\)/);
    expect(timeBudget(minutes(3), [], 3).note).toMatch(/^Time budget \(wrap\)/);
    expect(timeBudget(minutes(4.5), [], 3).answerOnly).toBe(true);
  });

  it("gives deep research its own longer clock", () => {
    const asked: ModelMessage[] = [{ role: "user", content: "Do deep research on solid-state batteries and write a full report." }];
    expect(timeBudget(minutes(20), asked, 45)).toEqual({ answerOnly: false });
    expect(timeBudget(minutes(45), asked, 45).note).toMatch(/^Time budget \(wrap\)/);
    expect(timeBudget(minutes(59), asked, 45).answerOnly).toBe(true);
  });

  it("holds an ordinary task's generous estimate to half an hour", () => {
    const asked: ModelMessage[] = [{ role: "user", content: "Compare three hotels near Disney and keep the pages open." }];
    expect(timeBudget(minutes(30), asked, 45).note).toMatch(/^Time budget \(wrap\)/);
  });
});
