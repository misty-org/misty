import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HeldClaims, heldClaimWaitMs, holdAfterJobMs } from "./workerHeldClaim";

describe("held claims", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("claims without waiting until the device has done browser work", () => {
    expect(new HeldClaims().next()).toBeUndefined();
  });

  it("holds claims for three minutes after a browser job", () => {
    const held = new HeldClaims();
    held.noteJob();
    expect(held.next()?.waitMs).toBe(heldClaimWaitMs);
    expect(held.holding()).toBe(true);
    vi.advanceTimersByTime(holdAfterJobMs - 1);
    expect(held.holding()).toBe(true);
    vi.advanceTimersByTime(2);
    expect(held.next()).toBeUndefined();
    expect(held.holding()).toBe(false);
  });

  it("hangs up the held claim when the worker stops", () => {
    const held = new HeldClaims();
    held.noteJob();
    const hold = held.next();
    held.cancel();
    expect(hold?.signal.aborted).toBe(true);
  });

  it("stops holding on a server that refuses the field, and only then", () => {
    const held = new HeldClaims();
    held.noteJob();
    expect(held.refused({ status: 429 })).toBe(false);
    expect(held.next()).toBeDefined();
    expect(held.refused({ status: 400 })).toBe(true);
    expect(held.next()).toBeUndefined();
  });
});
