import { describe, expect, it } from "vitest";
import { redactSecrets, rememberedUrl, skipReason, type RecallPrivacy } from "./privacy";
import { hammingDistance, simhash } from "./simhash";

const on: RecallPrivacy = { enabled: true, pausedUntil: 0, excludedSites: ["example.org"] };
const page = (url: string, extra: object = {}) => ({ url, private: false, ...extra });

describe("recall privacy", () => {
  it("remembers ordinary public pages only", () => {
    expect(skipReason(page("https://news.example.com/story"), on)).toBeNull();
    expect(skipReason(page("https://news.example.com/story"), { ...on, enabled: false })).toBe(
      "off",
    );
    expect(skipReason(page("https://a.com/"), { ...on, pausedUntil: Infinity })).toBe("paused");
    expect(skipReason(page("https://a.com/"), { ...on, pausedUntil: 1000 }, 2000)).toBeNull();
  });

  it("treats private and unknown windows alike", () => {
    expect(skipReason({ url: "https://a.com/", private: true }, on)).toBe("private");
    expect(skipReason({ url: "https://a.com/", private: undefined }, on)).toBe("private");
    expect(skipReason(page("https://a.com/", { agentOwned: true }), on)).toBe("agent");
  });

  it("skips excluded sites with their subdomains, and sensitive ones always", () => {
    expect(skipReason(page("https://docs.example.org/x"), on)).toBe("excluded");
    expect(skipReason(page("https://notexample.org/x"), on)).toBeNull();
    expect(skipReason(page("https://www.chase.com/"), on)).toBe("sensitive");
    expect(skipReason(page("https://mail.google.com/mail/u/0"), on)).toBe("sensitive");
    expect(skipReason(page("https://shop.com/checkout"), on)).toBe("sensitive");
    expect(skipReason(page("https://my.bank.co.uk/"), on)).toBe("sensitive");
    expect(skipReason(page("http://localhost:3000/"), on)).toBe("not-a-web-page");
    expect(skipReason(page("file:///etc/hosts"), on)).toBe("not-a-web-page");
  });

  it("drops fragments, credentials and secret-looking query values", () => {
    expect(rememberedUrl("https://u:p@a.com/x?q=cats&token=abc&page=2#top")).toBe(
      "https://a.com/x?q=cats&page=2",
    );
  });

  it("redacts secrets from page text", () => {
    // Built in pieces so no key-shaped literal sits in the source.
    const key = ["sk", "live", "abcdefghijklmnop"].join("_");
    const text = redactSecrets(`Card 4242 4242 4242 4242, mail ana@example.com, key ${key}`);
    expect(text).toBe("Card [number], mail [email], key [key]");
  });
});

describe("simhash", () => {
  const article =
    "The council voted on Tuesday to expand the bike lane network across the city center, adding twelve kilometres of protected lanes by next spring.";
  it("keeps near-identical pages close and different pages far", () => {
    const same = simhash(article);
    expect(same).toMatch(/^[0-9a-f]{16}$/);
    expect(simhash(article)).toBe(same);
    expect(hammingDistance(same, simhash(`${article} Updated 5 minutes ago.`))).toBeLessThanOrEqual(
      12,
    );
    expect(
      hammingDistance(
        same,
        simhash(
          "Recipe: whisk three eggs with flour, butter and a pinch of salt, then bake for twenty minutes.",
        ),
      ),
    ).toBeGreaterThan(12);
  });
});
