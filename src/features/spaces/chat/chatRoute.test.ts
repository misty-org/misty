import { describe, expect, it } from "vitest";
import type { SpaceConversation } from "@/features/spaces/api/dto/entities";
import { conversationPath } from "./chatRoute";
import { conversationName, groupConversations } from "./sidebar/conversationGroups";

const conversation = (patch: Partial<SpaceConversation>) =>
  ({
    id: "c",
    space_id: "home",
    title: "Launch",
    kind: "standard",
    participants: [],
    created_by_user_id: "me",
    created_at: "2026-10-16T00:00:00Z",
    updated_at: "2026-10-16T00:00:00Z",
    ...patch,
  }) as SpaceConversation;

describe("one chat system", () => {
  it("opens every chat in Space chat", () => {
    expect(conversationPath("home", conversation({ id: "c1" }))).toBe(
      "/spaces/home/social/misty?conversation=c1",
    );
  });

  it("lists channels newest first, and DMs apart, titled by the other person", () => {
    const channel = conversation({
      id: "channel_1",
      title: "Trip plans",
      updated_at: "2026-10-16T02:00:00Z",
    });
    const dm = conversation({
      id: "dm_1",
      kind: "dm",
      title: "me & Sam",
      participants: [
        { kind: "person", user_id: "me", name: "Me" },
        { kind: "person", user_id: "sam", name: "Sam" },
      ] as never,
    });
    const groups = groupConversations([conversation({ id: "c1" }), channel, dm]);
    expect(groups.map((group) => group.conversations.map((item) => item.id))).toEqual([
      ["channel_1", "c1"],
      ["dm_1"],
    ]);
    expect(conversationName(channel, "me")).toBe("Trip plans");
    expect(conversationName(dm, "me")).toBe("Sam");
  });
});
