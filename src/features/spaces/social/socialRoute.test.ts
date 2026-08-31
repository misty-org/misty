import { describe, expect, it } from "vitest";
import { socialConversationPath, socialProviderFromRoute, socialProviderPath } from "./socialRoute";

describe("Social provider routes", () => {
  it.each(["misty", "instagram", "messenger", "x", "discord"] as const)(
    "gives %s its own page",
    (provider) => {
      const route = `/spaces/family/social/${provider}`;
      expect(socialProviderFromRoute(route)).toBe(provider);
      expect(socialProviderPath("family", provider)).toBe(route);
    },
  );

  it("converts legacy provider queries without losing conversation state", () => {
    const legacy = "/spaces/family/social?provider=instagram&conversation=thread-1";
    expect(socialProviderFromRoute(legacy)).toBe("instagram");
    expect(
      socialProviderPath(
        "family",
        "instagram",
        new URL(legacy, "https://misty.local").searchParams,
      ),
    ).toBe("/spaces/family/social/instagram?conversation=thread-1");
  });

  it("keeps conversations inside their provider page", () => {
    expect(socialConversationPath("family", "discord", "thread-1")).toBe(
      "/spaces/family/social/discord?conversation=thread-1",
    );
  });
});
