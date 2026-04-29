import { describe, expect, it } from "vitest";

import {
  buildChatDisplayRows,
  formatChatMessageTime,
  isInFlightRun,
  messageReplyPreviewText,
} from "@/features/space-chat";
import type { SpaceMessage } from "@/services/spaces/dto/interfaces/types";

function message(id: string, sender: string, createdAt: string): SpaceMessage {
  return {
    seq: Number(id),
    id,
    space_id: "space-1",
    sender_user_id: sender,
    sender_name: sender,
    sender_kind: "person",
    content: [{ type: "text", text: id }],
    file_node_ids: [],
    created_at: createdAt,
  };
}

describe("Space chat display rows", () => {
  it("groups nearby messages from the same sender and starts each date with a divider", () => {
    const rows = buildChatDisplayRows([
      message("1", "alex", "2026-07-21T19:00:00.000Z"),
      message("2", "alex", "2026-07-21T19:02:00.000Z"),
      message("3", "sam", "2026-07-21T19:03:00.000Z"),
      message("4", "sam", "2026-07-22T19:03:00.000Z"),
    ]);

    expect(rows.map((row) => row.compact)).toEqual([false, true, false, false]);
    expect(rows[0].dateLabel).not.toBe("");
    expect(rows[1].dateLabel).toBe("");
    expect(rows[3].dateLabel).not.toBe("");
  });

  it("does not group replies or messages outside the grouping window", () => {
    const first = message("1", "alex", "2026-07-21T19:00:00.000Z");
    const reply = {
      ...message("2", "alex", "2026-07-21T19:01:00.000Z"),
      reply_to_message_id: first.id,
    };
    const later = message("3", "alex", "2026-07-21T19:10:00.000Z");

    expect(buildChatDisplayRows([first, reply, later]).map((row) => row.compact)).toEqual([
      false,
      false,
      false,
    ]);
  });

  it("formats message metadata as a time without a calendar date", () => {
    const formatted = formatChatMessageTime("2026-07-21T19:00:00.000Z");
    expect(formatted).toMatch(/\d/);
    expect(formatted).not.toContain("2026");
    expect(formatted).not.toContain("July");
  });

  it("builds a compact one-line preview for replied-to messages", () => {
    const repliedTo = message("1", "alex", "2026-07-21T19:00:00.000Z");
    repliedTo.content = [
      { type: "text", text: "I think it\ntried " },
      { type: "mention", user_id: "sam", label: "Sam" },
      { type: "text", text: "  to fix itself" },
    ];

    expect(messageReplyPreviewText(repliedTo)).toBe("I think it tried @Sam to fix itself");
  });
});

describe("Agent run states", () => {
  it("treats only the working states as in flight", () => {
    expect(["queued", "working", "retrying"].every((state) => isInFlightRun({ state }))).toBe(true);
    expect(
      ["completed", "failed", "canceled", "awaiting_approval"].some((state) =>
        isInFlightRun({ state }),
      ),
    ).toBe(false);
  });
});
