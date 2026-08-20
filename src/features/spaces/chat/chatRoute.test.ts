import { describe, expect, it } from "vitest";
import { spaceChatConversationPath, spaceChatPath } from "./chatRoute";

describe("Space chat routes", () => {
  it("opens the Space chat page", () => {
    expect(spaceChatPath("family")).toBe("/spaces/family/social/misty");
  });

  it("drops legacy provider queries without losing conversation state", () => {
    const legacy = "/spaces/family/social?provider=instagram&conversation=thread-1";
    expect(spaceChatPath("family", new URL(legacy, "https://misty.local").searchParams)).toBe(
      "/spaces/family/social/misty?conversation=thread-1",
    );
  });

  it("keeps conversations inside the chat page", () => {
    expect(spaceChatConversationPath("family", "thread-1")).toBe(
      "/spaces/family/social/misty?conversation=thread-1",
    );
  });
});
