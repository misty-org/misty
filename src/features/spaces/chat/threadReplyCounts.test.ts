import { describe, expect, it } from "vitest";
import type { SpaceMessage } from "../api/dto/entities";
import { withThreadReply, withoutThreadReply } from "./useSpaceMessageSpansStore";

const root = { id: "m1", reply_count: 2 } as SpaceMessage;
const other = { id: "m2", reply_count: 1 } as SpaceMessage;

describe("thread reply counts in a chat's list", () => {
  it("a new reply adds to its root, and nothing else", () => {
    const next = withThreadReply([root, other], {
      id: "r1",
      thread_root_id: "m1",
      created_at: "2026-11-20T10:00:00Z",
    } as SpaceMessage);
    expect(next.map((message) => message.reply_count)).toEqual([3, 1]);
    expect(next[0]?.last_reply_at).toBe("2026-11-20T10:00:00Z");
  });

  it("a deleted reply takes one from its root, never below none", () => {
    expect(withoutThreadReply([root, other], "m1").map((message) => message.reply_count)).toEqual([1, 1]);
    const empty = withoutThreadReply([{ id: "m3" } as SpaceMessage], "m3");
    expect(empty[0]?.reply_count).toBe(0);
  });
});
