import { describe, expect, it } from "vitest";
import { continuationEvent } from "../progress/continuationEvent";
import { isOpen, resumePrompt, splitLedger, withLedgerRows, type LedgerRow } from "./ledger";

const rows: LedgerRow[] = [
  {
    id: "r1",
    requirement: "Open site A",
    state: "done",
    evidence: { kind: "tab", ref: "https://a.example" },
  },
  { id: "r2", requirement: "Open site B", state: "failed", reason: "captcha", needs: "takeover" },
];

describe("ledger", () => {
  it("splits the ledger comment off the answer", () => {
    const text = withLedgerRows("Found A.\n\nStill incomplete:\n- Open site B: captcha", rows);
    const split = splitLedger(text);
    expect(split.text).toBe("Found A.\n\nStill incomplete:\n- Open site B: captcha");
    expect(split.rows).toEqual(rows);
  });

  it("leaves text without a ledger alone", () => {
    expect(splitLedger("Plain answer")).toEqual({ text: "Plain answer", rows: [] });
  });

  it("builds a resume prompt that works only the chosen rows and reads as an event line", () => {
    const prompt = resumePrompt(
      [...rows, { id: "r3", requirement: "Open site C", state: "failed" }],
      ["r2"],
    );
    expect(prompt).toMatch(/Done, so don't redo them[\s\S]*Open site A/);
    expect(prompt).toMatch(/to work now:\n- Open site B/);
    expect(prompt).toMatch(/leave alone for now:\n- Open site C/);
    expect(splitLedger(prompt).rows).toHaveLength(3);
    expect(continuationEvent(prompt)).toBe("Resumed the open items · Misty continued");
  });

  it("counts skipped rows as closed", () => {
    expect(rows.filter(isOpen).map((row) => row.id)).toEqual(["r2"]);
    expect(isOpen({ ...rows[1]!, state: "skipped" })).toBe(false);
  });
});
