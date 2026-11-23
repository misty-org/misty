import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginRealtimeEvent,
  doubtRealtimeCursor,
  finishRealtimeEvent,
  readRealtimeCursor,
  resetRealtimeCursor,
  resetRealtimeCursors,
} from "./realtime_cursor";

let accounts = 0;
const freshAccount = () => `cursor-account-${(accounts += 1)}-${Date.now()}`;

function apply(accountId: string, eventId: number): boolean {
  if (!beginRealtimeEvent(accountId, eventId)) return false;
  finishRealtimeEvent(accountId, eventId);
  return true;
}

describe("realtime cursor", () => {
  beforeEach(() => {
    resetRealtimeCursors();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("moves back to the server's newest event after a restore, so new events apply", () => {
    const account = freshAccount();
    apply(account, 900);
    expect(readRealtimeCursor(account)).toBe(900);
    expect(beginRealtimeEvent(account, 900)).toBe(false);

    resetRealtimeCursor(account, 800);

    expect(readRealtimeCursor(account)).toBe(800);
    expect(beginRealtimeEvent(account, 800)).toBe(false);
    expect(apply(account, 801)).toBe(true);
    expect(readRealtimeCursor(account)).toBe(801);
  });

  it("moves forward to the newest event on a resync", () => {
    const account = freshAccount();
    apply(account, 10);
    resetRealtimeCursor(account, 5_000);
    expect(readRealtimeCursor(account)).toBe(5_000);
    expect(beginRealtimeEvent(account, 4_000)).toBe(false);
  });

  it("follows the first live event after an empty resync once the cursor is in doubt", () => {
    const account = freshAccount();
    apply(account, 900);
    doubtRealtimeCursor(account);

    expect(apply(account, 805)).toBe(true);
    expect(readRealtimeCursor(account)).toBe(805);
    expect(beginRealtimeEvent(account, 700)).toBe(false);
  });

  it("stops doubting once an event above the cursor arrives, and never moves the cursor back", () => {
    const account = freshAccount();
    apply(account, 900);
    doubtRealtimeCursor(account);

    expect(apply(account, 901)).toBe(true);
    expect(apply(account, 850)).toBe(true);
    expect(readRealtimeCursor(account)).toBe(901);
  });

  it("never applies a finished event twice while an earlier one is still pending", () => {
    const account = freshAccount();
    expect(beginRealtimeEvent(account, 5)).toBe(true);
    expect(apply(account, 6)).toBe(true);
    expect(readRealtimeCursor(account)).toBe(0);

    expect(beginRealtimeEvent(account, 6)).toBe(false);

    finishRealtimeEvent(account, 5);
    expect(readRealtimeCursor(account)).toBe(6);
    expect(beginRealtimeEvent(account, 6)).toBe(false);
    expect(apply(account, 7)).toBe(true);
  });

  it("applies an event that committed after a higher one, without moving the cursor back", () => {
    const account = freshAccount();
    expect(apply(account, 101)).toBe(true);
    expect(apply(account, 100)).toBe(true);
    expect(readRealtimeCursor(account)).toBe(101);
    expect(beginRealtimeEvent(account, 100)).toBe(false);
    expect(beginRealtimeEvent(account, 101)).toBe(false);
  });

  it("applies only the unseen events of a replay that repeats the last few", () => {
    const account = freshAccount();
    apply(account, 99);
    apply(account, 101);

    const applied = [98, 99, 100, 101, 102].filter((id) => apply(account, id));

    expect(applied).toEqual([98, 100, 102]);
    expect(readRealtimeCursor(account)).toBe(102);
  });

  it("keeps a late lower event from holding the cursor back", () => {
    const account = freshAccount();
    apply(account, 101);
    expect(beginRealtimeEvent(account, 100)).toBe(true);
    expect(apply(account, 102)).toBe(true);
    expect(readRealtimeCursor(account)).toBe(102);
    finishRealtimeEvent(account, 100);
    expect(readRealtimeCursor(account)).toBe(102);
  });

  it("remembers what it has seen across a reload", () => {
    vi.useFakeTimers();
    const account = freshAccount();
    apply(account, 100);
    apply(account, 101);
    vi.advanceTimersByTime(1_000);

    resetRealtimeCursors();

    expect(readRealtimeCursor(account)).toBe(101);
    expect(beginRealtimeEvent(account, 100)).toBe(false);
    expect(beginRealtimeEvent(account, 101)).toBe(false);
    expect(apply(account, 99)).toBe(true);
  });

  it("saves what it has seen together with the cursor", () => {
    vi.useFakeTimers();
    const account = freshAccount();
    apply(account, 50);
    vi.advanceTimersByTime(1_000);
    apply(account, 100);

    resetRealtimeCursors();

    expect(readRealtimeCursor(account)).toBe(100);
    expect(beginRealtimeEvent(account, 100)).toBe(false);
  });

  it("saves a waiting record of what it has seen when the cursors are reset", () => {
    vi.useFakeTimers();
    const account = freshAccount();
    apply(account, 101);
    vi.advanceTimersByTime(1_000);
    apply(account, 100);

    resetRealtimeCursors();

    expect(beginRealtimeEvent(account, 100)).toBe(false);
    expect(beginRealtimeEvent(account, 101)).toBe(false);
  });

  it("forgets the oldest events past its bound and never applies them again", () => {
    const account = freshAccount();
    for (let id = 1; id <= 1_100; id += 1) apply(account, id);
    expect(beginRealtimeEvent(account, 1)).toBe(false);
    expect(beginRealtimeEvent(account, 1_100)).toBe(false);
    expect(readRealtimeCursor(account)).toBe(1_100);
  });
});
