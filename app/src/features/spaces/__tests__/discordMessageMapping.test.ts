import { describe, expect, it } from "vitest";

import {
  discordMessageToMirroredMessage,
  isSnowflakeAfter,
  nextSyncCursor,
  shouldMirrorDiscordMessage,
  shouldPublishToDiscord,
  spaceMessageToDiscordPayload,
  spansToText,
} from "@/features/space-connections/discordMessageMapping";
import type {
  DiscordMessage,
  SpaceDiscordLink,
} from "@/services/spaces/dto/interfaces/connections/discord";
import type { SpaceMessage } from "@/services/spaces/dto/interfaces/types";

function discordMessage(overrides: Partial<DiscordMessage> = {}): DiscordMessage {
  return {
    id: "1200000000000000002",
    channel_id: "channel-1",
    content: "ship it",
    timestamp: "2026-07-20T10:00:00.000Z",
    author: { id: "discord-user-1", username: "rey", global_name: "Rey" },
    type: 0,
    ...overrides,
  };
}

const link: Pick<SpaceDiscordLink, "bot_user_id" | "direction"> = {
  bot_user_id: "misty-bot",
  direction: "two_way",
};

describe("shouldMirrorDiscordMessage", () => {
  it("mirrors ordinary messages and inline replies", () => {
    expect(shouldMirrorDiscordMessage(discordMessage(), link)).toBe(true);
    expect(shouldMirrorDiscordMessage(discordMessage({ type: 19 }), link)).toBe(true);
  });

  it("drops the bot's own messages so mirroring cannot loop", () => {
    const echo = discordMessage({ author: { id: "misty-bot", username: "misty" } });
    expect(shouldMirrorDiscordMessage(echo, link)).toBe(false);
  });

  it("drops webhook posts, which is how Misty publishes outward", () => {
    expect(shouldMirrorDiscordMessage(discordMessage({ webhook_id: "hook-1" }), link)).toBe(false);
  });

  it("ignores join notices and other system message types", () => {
    expect(shouldMirrorDiscordMessage(discordMessage({ type: 7 }), link)).toBe(false);
  });

  it("ignores empty messages but keeps attachment-only ones", () => {
    expect(shouldMirrorDiscordMessage(discordMessage({ content: "   " }), link)).toBe(false);
    const withFile = discordMessage({
      content: "",
      attachments: [{ id: "a1", filename: "spec.pdf", url: "https://cdn.discord/spec.pdf" }],
    });
    expect(shouldMirrorDiscordMessage(withFile, link)).toBe(true);
  });

  it("refuses inbound traffic on an outbound-only link", () => {
    expect(shouldMirrorDiscordMessage(discordMessage(), { direction: "outbound" })).toBe(false);
  });
});

describe("discordMessageToMirroredMessage", () => {
  it("records author and source so the transcript stays attributable", () => {
    const mapped = discordMessageToMirroredMessage(discordMessage());
    expect(mapped.sender_name).toBe("Rey");
    expect(mapped.origin).toMatchObject({
      system: "discord",
      external_id: "1200000000000000002",
      external_channel_id: "channel-1",
      author_handle: "rey",
      authored_at: "2026-07-20T10:00:00.000Z",
    });
    expect(mapped.content).toEqual([{ type: "text", text: "ship it" }]);
  });

  it("falls back to the username when there is no display name", () => {
    const mapped = discordMessageToMirroredMessage(
      discordMessage({ author: { id: "u2", username: "finn", global_name: null } }),
    );
    expect(mapped.sender_name).toBe("finn");
  });

  it("turns a linked Discord account into a real Misty mention", () => {
    const mapped = discordMessageToMirroredMessage(
      discordMessage({ content: "ping <@980000000000000009> now" }),
      {
        misty_user_ids: { "980000000000000009": "misty-user-9" },
        labels: { "980000000000000009": "Poe" },
      },
    );
    expect(mapped.content).toEqual([
      { type: "text", text: "ping " },
      { type: "mention", user_id: "misty-user-9", label: "Poe" },
      { type: "text", text: " now" },
    ]);
  });

  it("degrades an unlinked mention to readable text instead of a raw token", () => {
    const mapped = discordMessageToMirroredMessage(
      discordMessage({ content: "hi <@980000000000000009>" }),
      { labels: { "980000000000000009": "Poe" } },
    );
    expect(spansToText(mapped.content)).toBe("hi @Poe");
  });

  it("summarizes attachments as links rather than mirroring bytes", () => {
    const mapped = discordMessageToMirroredMessage(
      discordMessage({
        attachments: [{ id: "a1", filename: "spec.pdf", url: "https://cdn.discord/spec.pdf" }],
      }),
    );
    expect(spansToText(mapped.content)).toContain("spec.pdf");
    expect(mapped.origin.attachment_urls).toEqual(["https://cdn.discord/spec.pdf"]);
  });

  it("carries the replied-to id so threading can be added later", () => {
    const mapped = discordMessageToMirroredMessage(
      discordMessage({ type: 19, referenced_message: { id: "1100000000000000001" } }),
    );
    expect(mapped.reply_to_external_id).toBe("1100000000000000001");
  });
});

describe("spaceMessageToDiscordPayload", () => {
  const message: Pick<SpaceMessage, "content" | "sender_name"> = {
    sender_name: "Rey",
    content: [
      { type: "text", text: "hey " },
      { type: "mention", user_id: "u9", label: "Poe" },
      { type: "text", text: " look at this" },
    ],
  };

  it("flattens spans to plain text under the Misty author's name", () => {
    const payload = spaceMessageToDiscordPayload(message);
    expect(payload.content).toBe("hey @Poe look at this");
    expect(payload.username).toBe("Rey");
  });

  it("never lets a mirrored message ping a Discord server", () => {
    const payload = spaceMessageToDiscordPayload({
      sender_name: "Rey",
      content: [{ type: "text", text: "@everyone deploy now" }],
    });
    expect(payload.allowed_mentions).toEqual({ parse: [] });
  });

  it("truncates past Discord's 2000 character limit", () => {
    const payload = spaceMessageToDiscordPayload({
      sender_name: "Rey",
      content: [{ type: "text", text: "x".repeat(2500) }],
    });
    expect(payload.content).toHaveLength(2000);
    expect(payload.content.endsWith("…")).toBe(true);
  });

  it("references the source message when replying", () => {
    const payload = spaceMessageToDiscordPayload(message, { replyToExternalId: "123" });
    expect(payload.message_reference).toEqual({ message_id: "123" });
  });
});

describe("shouldPublishToDiscord", () => {
  it("publishes a person's Misty message", () => {
    const message = {
      sender_kind: "person" as const,
      content: [{ type: "text" as const, text: "hi" }],
    };
    expect(shouldPublishToDiscord(message, { direction: "two_way" })).toBe(true);
  });

  it("never bounces a Discord-sourced message back to Discord", () => {
    expect(
      shouldPublishToDiscord(
        {
          sender_kind: "person",
          content: [{ type: "text", text: "hi" }],
          origin: { system: "discord", external_id: "1" },
        },
        { direction: "two_way" },
      ),
    ).toBe(false);
  });

  it("keeps agent and system output inside the Space", () => {
    const content = [{ type: "text" as const, text: "run finished" }];
    expect(
      shouldPublishToDiscord({ sender_kind: "agent", content }, { direction: "two_way" }),
    ).toBe(false);
    expect(
      shouldPublishToDiscord({ sender_kind: "system", content }, { direction: "two_way" }),
    ).toBe(false);
  });

  it("refuses outbound traffic on an inbound-only link", () => {
    expect(
      shouldPublishToDiscord(
        { sender_kind: "person", content: [{ type: "text", text: "hi" }] },
        { direction: "inbound" },
      ),
    ).toBe(false);
  });

  it("skips whitespace-only messages", () => {
    expect(
      shouldPublishToDiscord(
        { sender_kind: "person", content: [{ type: "text", text: "   " }] },
        { direction: "two_way" },
      ),
    ).toBe(false);
  });
});

describe("nextSyncCursor", () => {
  it("advances to the highest snowflake, not the last one in the page", () => {
    const cursor = nextSyncCursor("1200000000000000000", [
      { id: "1200000000000000005" },
      { id: "1200000000000000003" },
    ]);
    expect(cursor).toBe("1200000000000000005");
  });

  it("compares numerically, so a shorter id never wins on string order", () => {
    expect(isSnowflakeAfter("9", "10")).toBe(false);
    expect(nextSyncCursor("10", [{ id: "9" }])).toBe("10");
  });

  it("keeps the cursor when a page is empty or malformed", () => {
    expect(nextSyncCursor("1200000000000000000", [])).toBe("1200000000000000000");
    expect(nextSyncCursor("1200000000000000000", [{ id: "not-a-snowflake" }])).toBe(
      "1200000000000000000",
    );
  });

  it("starts from the first message when there is no cursor yet", () => {
    expect(nextSyncCursor(undefined, [{ id: "1200000000000000002" }])).toBe("1200000000000000002");
  });
});
