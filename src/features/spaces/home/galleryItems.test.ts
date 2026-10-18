import { describe, expect, it } from "vitest";
import type { SpaceLibraryItem } from "@/api/spaces/dto/entities";
import {
  agentChatItem,
  chatItem,
  editedLabel,
  libraryKind,
  visibleGallery,
  type GalleryItem,
} from "./galleryItems";

const item = (
  key: string,
  kind: GalleryItem["kind"],
  title: string,
  updatedAt: string,
  creatorId = "me",
): GalleryItem => ({
  key,
  kind,
  title,
  updatedAt,
  creatorId,
  href: `/x/${key}`,
});
const items = [
  item("a", "note", "Weekly sync", "2026-10-16T10:00:00Z"),
  item("b", "drawing", "Launch flow", "2026-10-16T12:00:00Z", "ada"),
  item("c", "image", "Venue", "2026-10-15T09:00:00Z", "ada"),
  item("d", "code", "misty-eval-sandbox", "2026-10-14T09:00:00Z"),
];
const base = {
  filter: "all" as const,
  madeBy: "anyone" as const,
  sort: "edited" as const,
  me: "me",
  query: "",
};

describe("Space home gallery", () => {
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
    const agentChat = agentChatItem(
      { id: "c2", title: "Trip plan", agentId: "a1", updatedAt: "2026-10-16T09:00:00Z" },
      { id: "a1", name: "Misty" },
      "me",
    );
    expect(agentChat.href).toBe("/agents?conversation=c2&agent=a1");
    expect(
      visibleGallery([chat, agentChat, ...items], { ...base, filter: "chats" }).map((i) => i.key),
    ).toEqual(["chat:c1", "agent-chat:c2"]);
  });
  it("shows everything newest first", () => {
    expect(visibleGallery(items, base).map((i) => i.key)).toEqual(["b", "a", "c", "d"]);
  });
  it("filters by tab, maker and search, and sorts by name", () => {
    expect(visibleGallery(items, { ...base, filter: "images" }).map((i) => i.key)).toEqual(["c"]);
    expect(visibleGallery(items, { ...base, madeBy: "me" }).map((i) => i.key)).toEqual(["a", "d"]);
    expect(visibleGallery(items, { ...base, madeBy: "others" }).map((i) => i.key)).toEqual([
      "b",
      "c",
    ]);
    expect(visibleGallery(items, { ...base, query: "SYNC" }).map((i) => i.key)).toEqual(["a"]);
    expect(visibleGallery(items, { ...base, sort: "name" }).map((i) => i.title)).toEqual([
      "Launch flow",
      "misty-eval-sandbox",
      "Venue",
      "Weekly sync",
    ]);
  });
  it("puts pictures and videos under Images and the rest under Files", () => {
    const file = (name: string) =>
      ({
        file: { original_filename: name, intrinsic_metadata: {} },
      }) as unknown as SpaceLibraryItem;
    expect(libraryKind(file("venue.jpg"))).toBe("image");
    expect(libraryKind(file("tour.mp4"))).toBe("image");
    expect(libraryKind(file("budget.csv"))).toBe("file");
  });
  it("says when something was edited", () => {
    const now = Date.parse("2026-10-16T12:00:00Z");
    expect(editedLabel("2026-10-16T11:59:40Z", now)).toBe("just now");
    expect(editedLabel("2026-10-16T10:00:00Z", now)).toBe("2 hours ago");
    expect(editedLabel("not a date", now)).toBe("");
  });
});
