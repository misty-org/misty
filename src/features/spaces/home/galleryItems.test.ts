import { describe, expect, it } from "vitest";
import type { SpaceLibraryItem } from "@/features/spaces/api/dto/entities";
import type { ServerSpaceNote } from "../journal/notes/api/api";
import { chatItem, editedLabel, libraryKind, noteItem } from "./galleryItems";

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
  it("opens a Lab notebook's doc in the Lab, named without its prefix", () => {
    const doc = (title: string) =>
      ({
        id: "d 1",
        title,
        markdown: "Lava\n\nflows",
        creator_user_id: "ada",
        updated_at: "2026-10-16T13:00:00Z",
      }) as unknown as ServerSpaceNote;
    const notebook = noteItem("s1", doc("Notebook: Volcanoes"));
    expect(notebook).toMatchObject({ kind: "note", notebook: true, title: "Volcanoes" });
    expect(notebook.href).toBe("/spaces/s1/lab?doc=d%201");
    expect(notebook.excerpt).toBe("Lava flows");
    expect(noteItem("s1", doc("Notebook: ")).title).toBe("Untitled notebook");

    const plain = noteItem("s1", doc("Volcanoes"));
    expect(plain.notebook).toBeUndefined();
    expect(plain.href).toBe("/spaces/s1/notes?note=d%201");
  });
  it("says when something was edited", () => {
    const now = Date.parse("2026-10-16T12:00:00Z");
    expect(editedLabel("2026-10-16T11:59:40Z", now)).toBe("just now");
    expect(editedLabel("2026-10-16T10:00:00Z", now)).toBe("2 hours ago");
    expect(editedLabel("not a date", now)).toBe("");
  });
});
