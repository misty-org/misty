import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HeldClaims, heldClaimWaitMs } from "./workerHeldClaim";

describe("held claims", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("claims without waiting until the device has done browser work", () => {
    expect(new HeldClaims().next()).toBeUndefined();
  });

  it("holds the next claim for 30 seconds after a browser job", () => {
    const held = new HeldClaims();
    held.noteBrowserJob();
    expect(held.next()?.waitMs).toBe(heldClaimWaitMs);
    vi.advanceTimersByTime(30_001);
    expect(held.next()).toBeUndefined();
  });

  it("hangs up the held claim when the worker stops", () => {
    const held = new HeldClaims();
    held.noteBrowserJob();
    const hold = held.next();
    held.cancel();
    expect(hold?.signal.aborted).toBe(true);
  });

  it("stops holding on a server that refuses the field, and only then", () => {
    const held = new HeldClaims();
    held.noteBrowserJob();
    expect(held.refused({ status: 429 })).toBe(false);
    expect(held.next()).toBeDefined();
    expect(held.refused({ status: 400 })).toBe(true);
    expect(held.next()).toBeUndefined();
  });
});
