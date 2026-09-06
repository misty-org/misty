import { describe, expect, it } from "vitest";
import { shouldShowSocialConversation, socialLandingConversation } from "./SpaceChat";

describe("Social provider conversation isolation", () => {
  it.each(["instagram", "messenger", "x", "discord"] as const)(
    "keeps %s empty until one of its conversations is selected",
    (provider) => {
      expect(shouldShowSocialConversation(provider, "", undefined)).toBe(false);
    },
  );

  it("does not show a conversation selected under another provider", () => {
    expect(shouldShowSocialConversation("instagram", "conversation-1", "discord")).toBe(false);
  });

  it("shows the selected conversation only under its own provider", () => {
    expect(shouldShowSocialConversation("instagram", "conversation-1", "instagram")).toBe(true);
    expect(shouldShowSocialConversation("misty", "", undefined)).toBe(true);
  });
});

describe("Social provider landing selection", () => {
  const conversations = [
    { id: "instagram-1", kind: "standard", origin: "instagram" },
    { id: "discord-agent", kind: "direct", origin: "discord", direct_agent_id: "agent-1" },
    { id: "discord-1", kind: "standard", origin: "discord" },
  ];

  it("keeps native Social on Everyone", () => {
    expect(socialLandingConversation("misty", conversations)).toBeUndefined();
  });

  it("opens the first matching external conversation and skips agent DMs", () => {
    expect(socialLandingConversation("instagram", conversations)?.id).toBe("instagram-1");
    expect(socialLandingConversation("discord", conversations)?.id).toBe("discord-1");
  });
});
