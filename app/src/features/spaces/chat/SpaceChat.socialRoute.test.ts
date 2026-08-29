import { describe, expect, it } from "vitest";
import {
  shouldOpenMistySupportConversation,
  shouldShowSocialConversation,
  socialLandingConversation,
} from "./SpaceChat";

describe("Misty Social landing route", () => {
  it.each(["instagram", "messenger", "x", "discord"] as const)(
    "preserves an explicit %s provider instead of opening Misty support",
    (provider) => {
      expect(shouldOpenMistySupportConversation("misty", "", provider)).toBe(false);
    },
  );

  it("opens Misty support from the unfiltered Misty Social landing page", () => {
    expect(shouldOpenMistySupportConversation("misty", "", "misty")).toBe(true);
  });

  it("does not replace an explicitly selected conversation", () => {
    expect(shouldOpenMistySupportConversation("misty", "conversation-1", "misty")).toBe(false);
  });

  it("does not apply Misty support routing to regular Spaces", () => {
    expect(shouldOpenMistySupportConversation("shared", "", "misty")).toBe(false);
  });
});

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
    { id: "support-1", kind: "misty_support", origin: "misty" },
    { id: "instagram-1", kind: "standard", origin: "instagram" },
    { id: "discord-agent", kind: "direct", origin: "discord", direct_agent_id: "agent-1" },
    { id: "discord-1", kind: "standard", origin: "discord" },
  ];

  it("opens private support from the canonical Misty Space", () => {
    expect(socialLandingConversation("misty", "misty", conversations)?.id).toBe("support-1");
  });

  it("keeps the regular Misty page on Everyone", () => {
    expect(socialLandingConversation("misty", "standard", conversations)).toBeUndefined();
  });

  it("opens the first matching external conversation and skips agent DMs", () => {
    expect(socialLandingConversation("instagram", "standard", conversations)?.id).toBe(
      "instagram-1",
    );
    expect(socialLandingConversation("discord", "standard", conversations)?.id).toBe("discord-1");
  });
});
