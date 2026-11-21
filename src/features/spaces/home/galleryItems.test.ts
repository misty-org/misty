import { describe, expect, it } from "vitest";
import { chatItem, editedLabel } from "./galleryItems";

describe("Space gallery", () => {
  it("lists chats as one more kind, named after who they're with", () => {
    const chat = chatItem(
      "s1",
      {
        id: "c1",
        space_id: "s1",
        title: "",
        created_by_user_id: "me",
        participants: [
          { kind: "person", user_id: "me", name: "Me", joined_at: "" },
          { kind: "person", user_id: "ada", name: "Ada", joined_at: "" },
        ],
        created_at: "2026-10-16T08:00:00Z",
        updated_at: "2026-10-16T13:00:00Z",
      },
      "me",
    );
    expect(chat).toMatchObject({ kind: "chat", title: "Ada", people: ["Ada"] });
    expect(chat.href).toBe("/spaces/s1/social/misty?conversation=c1");
  });
  it("says when something was edited", () => {
    const now = Date.parse("2026-10-16T12:00:00Z");
    expect(editedLabel("2026-10-16T11:59:40Z", now)).toBe("just now");
    expect(editedLabel("2026-10-16T10:00:00Z", now)).toBe("2 hours ago");
    expect(editedLabel("not a date", now)).toBe("");
  });
});
