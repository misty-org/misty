import { describe, expect, it } from "vitest";
import type { SpaceMessage } from "../api/dto/entities";
import {
  activeClaims,
  claimBody,
  claimLifetimeMs,
  handoffBody,
  handoffIsFor,
  incomingHandoffs,
  overlappingClaim,
  pendingHandoffs,
  postedAgo,
  readSpacePost,
} from "./spacePosts";

const now = Date.parse("2026-11-11T12:00:00Z");
let next = 0;

function message(text: string, over: Partial<SpaceMessage> = {}): SpaceMessage {
  next += 1;
  return {
    seq: next,
    id: `m${next}`,
    space_id: "s1",
    sender_user_id: "ana",
    sender_name: "Ana",
    sender_kind: "person",
    content: [{ type: "text", text }],
    file_node_ids: [],
    created_at: new Date(now - 60_000).toISOString(),
    ...over,
  };
}

describe("readSpacePost", () => {
  it("reads what handoffBody and claimBody write", () => {
    expect(readSpacePost(message(handoffBody("  Check the login page\nand report  ")))).toEqual({
      kind: "handoff",
      text: "Check the login page\nand report",
    });
    expect(readSpacePost(message(claimBody("the  login\npage")))).toEqual({
      kind: "claim",
      text: "the login page",
    });
  });

  it("ignores case and leading space, and wants words after the mark", () => {
    expect(readSpacePost(message("  handoff: do this"))?.kind).toBe("handoff");
    expect(readSpacePost(message("WORKING ON: tests"))?.kind).toBe("claim");
    expect(readSpacePost(message("Handoff:"))).toBeUndefined();
    expect(readSpacePost(message("About the handoff: fine"))).toBeUndefined();
  });

  it("never reads an agent's or the system's message as either", () => {
    expect(readSpacePost(message("Handoff: do this", { sender_kind: "agent" }))).toBeUndefined();
    expect(readSpacePost(message("Handoff: do this", { sender_kind: "system" }))).toBeUndefined();
    expect(
      readSpacePost(message("Working on: x", { origin: { kind: "misty_assistant" } })),
    ).toBeUndefined();
  });
});

describe("handoffs", () => {
  it("is for me in a direct message from someone else", () => {
    const sent = message("Handoff: review this");
    expect(handoffIsFor(sent, "ben", true)).toBe(true);
    expect(handoffIsFor(sent, "ana", true)).toBe(false);
    expect(handoffIsFor(sent, "ben", false)).toBe(false);
    expect(handoffIsFor(sent, "", true)).toBe(false);
    expect(
      handoffIsFor(message("Handoff: x", { local_delivery_state: "sending" }), "ben", true),
    ).toBe(false);
  });

  it("is for me outside a direct message only when it mentions me", () => {
    const mentioned = message("", {
      content: [
        { type: "text", text: "Handoff: " },
        { type: "mention", user_id: "ben", label: "Ben" },
        { type: "text", text: " review this" },
      ],
    });
    expect(handoffIsFor(mentioned, "ben", false)).toBe(true);
    expect(handoffIsFor(mentioned, "cal", false)).toBe(false);
    expect(incomingHandoffs([mentioned], "ben", false)[0]).toMatchObject({
      fromUserId: "ana",
      fromName: "Ana",
      text: "@Ben review this",
      conversationId: "",
    });
  });

  it("keeps what is not handled, once each, newest first", () => {
    const older = message("Handoff: one", { created_at: "2026-11-10T08:00:00Z" });
    const newer = message("Handoff: two", { created_at: "2026-11-11T08:00:00Z" });
    const done = message("Handoff: three");
    const all = incomingHandoffs([older, message("hello"), newer, done, newer], "ben", true);
    expect(pendingHandoffs(all, [done.id]).map((handoff) => handoff.text)).toEqual(["two", "one"]);
  });
});

describe("claims", () => {
  it("lists claims from the last day, newest first", () => {
    const stale = message("Working on: old thing", {
      created_at: new Date(now - claimLifetimeMs - 1).toISOString(),
    });
    const early = message("Working on: login page", {
      created_at: new Date(now - 3_600_000).toISOString(),
    });
    const late = message("Working on: billing", { sender_user_id: "ben", sender_name: "Ben" });
    const failed = message("Working on: x", { local_delivery_state: "failed" });
    const claims = activeClaims([stale, early, message("hi"), late, failed], now);
    expect(claims.map((claim) => [claim.name, claim.text])).toEqual([
      ["Ben", "billing"],
      ["Ana", "login page"],
    ]);
  });

  it("warns when another member's claim shares a word", () => {
    const claims = activeClaims(
      [
        message("Working on: the Login page"),
        message("Working on: docs", { sender_user_id: "me" }),
      ],
      now,
    );
    expect(overlappingClaim("fixing login redirect", claims, "me")?.text).toBe("the Login page");
    expect(overlappingClaim("the docs", claims, "me")).toBeUndefined();
    expect(overlappingClaim("the settings page", claims, "me")).toBeUndefined();
    expect(overlappingClaim("", claims, "me")).toBeUndefined();
  });

  it("says how long ago", () => {
    expect(postedAgo(new Date(now - 20_000).toISOString(), now)).toBe("Just now");
    expect(postedAgo(new Date(now - 5 * 60_000).toISOString(), now)).toBe("5 min ago");
    expect(postedAgo(new Date(now - 3 * 3_600_000).toISOString(), now)).toBe("3 h ago");
  });
});
