import { describe, expect, it } from "vitest";
import { conversationIdFor, followAddress, goNow, runIdFor, runIdOfFollowAddress } from "./runIdentity";

describe("a run's id", () => {
  it("is the same for the same turn, and differs by turn and account", async () => {
    const one = await runIdFor("me", "key");
    expect(one).toMatch(/^invocation_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(await runIdFor("me", "key")).toBe(one);
    expect(await runIdFor("me", "other")).not.toBe(one);
    expect(await runIdFor("you", "key")).not.toBe(one);
    expect(await conversationIdFor("me", "key")).toMatch(/^conversation_/);
  });

  it("names what a follower follows", () => {
    expect(runIdOfFollowAddress(followAddress("invocation_1"))).toBe("invocation_1");
  });
});

describe("the clock a run starts with", () => {
  const at = new Date("2026-11-07T03:04:05.678Z");

  it("writes Z for UTC, as Go does", () => {
    expect(goNow("UTC", at)).toBe("2026-11-07T03:04:05Z");
  });

  it("gives the person's own date and offset", () => {
    expect(goNow("America/Los_Angeles", at)).toBe("2026-11-06T19:04:05-08:00");
    expect(goNow("Asia/Kolkata", at)).toBe("2026-11-07T08:34:05+05:30");
  });

  it("falls back to UTC for a timezone it can't read", () => {
    expect(goNow("Not/AZone", at)).toBe("2026-11-07T03:04:05Z");
  });
});
