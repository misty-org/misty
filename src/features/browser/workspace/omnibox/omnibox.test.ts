import { describe, expect, it } from "vitest";
import { mergeMatches } from "./controller";
import { createOmniboxProviders, type OmniboxDeps } from "./providers";
import type { OmniboxInput, OmniboxMatch } from "./types";
import { inlineCompletion, strippedUrl } from "./urlText";

const now = Date.now();

function deps(overrides: Partial<OmniboxDeps> = {}): OmniboxDeps {
  return {
    searchEngine: () => ({ id: "google", name: "Google" }),
    searchUrl: (text) => `https://www.google.com/search?q=${encodeURIComponent(text)}`,
    searchSuggestionsEnabled: () => false,
    fetchSearchSuggestions: async () => [],
    historySuggestions: async () => [],
    bookmarks: () => [],
    mistyContent: () => [],
    clipboardUrl: async () => null,
    openTabs: () => [],
    ...overrides,
  };
}

function input(text: string, overrides: Partial<OmniboxInput> = {}): OmniboxInput {
  return {
    text,
    tabId: "tab-1",
    currentUrl: "https://current.example/",
    private: false,
    sessionHistory: [],
    ...overrides,
  };
}

/** Runs every provider to completion, as the address bar would after typing stops. */
async function suggest(text: string, d = deps(), overrides: Partial<OmniboxInput> = {}) {
  const signal = new AbortController().signal;
  const groups = await Promise.all(
    createOmniboxProviders(d).map((provider) => provider.start(input(text, overrides), signal)),
  );
  return mergeMatches(groups);
}

const visited = (url: string, visits: number, typedVisits: number, title = "") => ({
  url,
  title,
  visits,
  typedVisits,
  lastVisitedAt: now,
});

describe("address text", () => {
  it("strips the parts people do not type", () => {
    expect(strippedUrl("https://www.github.com/")).toBe("github.com");
    expect(strippedUrl("https://docs.example.com/start?x=1")).toBe("docs.example.com/start?x=1");
  });

  it("completes a typed prefix and nothing else", () => {
    expect(inlineCompletion("git", "https://www.github.com/")).toBe("hub.com");
    expect(inlineCompletion("https://git", "https://github.com/")).toBe("hub.com");
    expect(inlineCompletion("hub", "https://github.com/")).toBeUndefined();
    expect(inlineCompletion("github.com", "https://github.com/")).toBeUndefined();
    expect(inlineCompletion("git hub", "https://github.com/")).toBeUndefined();
  });
});

describe("omnibox ranking", () => {
  it("offers a direct site before a web search, without fetching its favicon", async () => {
    const matches = await suggest("youtube.com");
    expect(matches.map((match) => match.kind)).toEqual(["url", "search"]);
    expect(matches[0].target).toEqual({ type: "navigate", url: "https://youtube.com/" });
    expect(matches[0].faviconUrl).toBeNull();
    expect(matches[1].detail).toBe("Search with Google");
  });

  it("offers local development addresses directly", async () => {
    const matches = await suggest("localhost:3000");
    expect(matches[0].target).toEqual({ type: "navigate", url: "http://localhost:3000/" });
    expect(matches[0].title).toBe("localhost:3000");
  });

  it("searches plain text by default", async () => {
    const matches = await suggest("misty weather");
    expect(matches[0].kind).toBe("search");
    expect(matches[0].allowedToBeDefault).toBe(true);
  });

  it("completes a familiar typed page inline, ahead of searching", async () => {
    const matches = await suggest(
      "git",
      deps({ historySuggestions: async () => [visited("https://github.com/", 6, 3, "GitHub")] }),
    );
    expect(matches[0].kind).toBe("history");
    expect(matches[0].inlineCompletion).toBe("hub.com");
    expect(matches[0].removable).toBe(true);
  });

  it("keeps a page seen once below the search and does not complete it", async () => {
    const matches = await suggest(
      "git",
      deps({ historySuggestions: async () => [visited("https://github.com/", 1, 0)] }),
    );
    expect(matches[0].kind).toBe("search");
    const page = matches.find((match) => match.kind === "history");
    expect(page?.allowedToBeDefault).toBe(false);
  });

  it("merges one page from history, bookmarks and an open tab into one row", async () => {
    const matches = await suggest(
      "docs",
      deps({
        historySuggestions: async () => [visited("https://docs.example.com/start", 2, 0)],
        bookmarks: () => [{ url: "https://docs.example.com/start", title: "Docs" }],
        openTabs: () => [
          {
            tabId: "tab-2",
            url: "https://docs.example.com/start",
            title: "Docs",
            private: false,
            agentOwned: false,
          },
        ],
      }),
    );
    const rows = matches.filter((match) => match.target.url === "https://docs.example.com/start");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ bookmarked: true, removable: true, switchTabId: "tab-2" });
  });

  it("keeps private and agent tabs out of an ordinary tab's suggestions", async () => {
    const tab = (tabId: string, extra: object) => ({
      tabId,
      url: "https://secret.example/",
      title: "Secret",
      private: false,
      agentOwned: false,
      ...extra,
    });
    const matches = await suggest(
      "secret",
      deps({ openTabs: () => [tab("private", { private: true }), tab("agent", { agentOwned: true })] }),
    );
    expect(matches.some((match) => match.kind === "tab")).toBe(false);
  });

  it("offers Misty's own pages by name", async () => {
    const matches = await suggest("downloads");
    expect(matches.some((match) => match.target.url === "misty://downloads")).toBe(true);
  });
});

describe("before typing", () => {
  it("defaults to the current page, then recent and top pages", async () => {
    const matches = await suggest(
      "",
      deps({ historySuggestions: async () => [visited("https://news.example/", 9, 2)] }),
      { sessionHistory: ["https://one.example/", "https://two.example/path", "https://current.example/"] },
    );
    expect(matches[0].target.url).toBe("https://current.example/");
    expect(matches.map((match) => match.detail)).toEqual(
      expect.arrayContaining(["news.example", "two.example/path", "one.example"]),
    );
  });

  it("reads no durable history in a private tab", async () => {
    let asked = false;
    await suggest(
      "",
      deps({
        historySuggestions: async () => {
          asked = true;
          return [];
        },
      }),
      { private: true },
    );
    expect(asked).toBe(false);
  });
});

describe("search suggestions", () => {
  const enabled = (fetched: string[], calls: string[] = []) =>
    deps({
      searchSuggestionsEnabled: () => true,
      fetchSearchSuggestions: async (engine, text) => {
        calls.push(`${engine}:${text}`);
        return fetched;
      },
    });

  it("adds engine suggestions below the typed search", async () => {
    const matches = await suggest("misty", enabled(["misty copeland", "misty step"]));
    expect(matches[0].title).toBe("misty");
    expect(matches.filter((match: OmniboxMatch) => match.kind === "suggestion").map((m) => m.title)).toEqual([
      "misty copeland",
      "misty step",
    ]);
  });

  it("never sends addresses, private text or anything when turned off", async () => {
    const calls: string[] = [];
    await suggest("example.com/account", enabled([], calls));
    await suggest("misty", enabled([], calls), { private: true });
    await suggest(
      "misty",
      deps({
        fetchSearchSuggestions: async (_, text) => {
          calls.push(text);
          return [];
        },
      }),
    );
    expect(calls).toEqual([]);
  });
});

describe("Misty content and copied links", () => {
  it("offers matching notes that open inside Misty", async () => {
    const matches = await suggest(
      "trip",
      deps({
        mistyContent: () => [{ id: "note:1", title: "Trip plan", detail: "note", route: "/spaces/s1/journal" }],
      }),
    );
    const note = matches.find((match) => match.kind === "content");
    expect(note?.target).toEqual({ type: "open-in-app", url: "/spaces/s1/journal" });
    expect(note?.allowedToBeDefault).toBe(false);
  });

  it("offers a copied web link before typing, but not in private tabs", async () => {
    const withClipboard = deps({ clipboardUrl: async () => "https://copied.example/page" });
    const matches = await suggest("", withClipboard);
    expect(matches.find((match) => match.title === "Link you copied")?.target.url).toBe(
      "https://copied.example/page",
    );
    const privateMatches = await suggest("", withClipboard, { private: true });
    expect(privateMatches.some((match) => match.title === "Link you copied")).toBe(false);
  });

  it("ignores clipboard text that is not a web address", async () => {
    const matches = await suggest("", deps({ clipboardUrl: async () => "just some words" }));
    expect(matches.some((match) => match.title === "Link you copied")).toBe(false);
  });
});
