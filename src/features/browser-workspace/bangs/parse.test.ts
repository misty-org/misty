import { afterEach, describe, expect, it } from "vitest";
import {
  configureBrowserCustomBangs,
  parseBrowserCustomBangs,
} from "@/features/workspace/browserSearchEngine";
import { allBangs } from "./catalog";
import { bangDestination, matchingBangs, parseBang, parseLeadingBang } from "./parse";
import type { WebBang } from "./types";

afterEach(() => configureBrowserCustomBangs("[]"));

function web(trigger: string): WebBang {
  const bang = allBangs().find((entry) => entry.trigger === trigger);
  if (bang?.kind !== "web") throw new Error(`!${trigger} is not a website shortcut`);
  return bang;
}

describe("bang parsing", () => {
  it("reads a leading shortcut once a space follows, matching aliases and case", () => {
    expect(parseLeadingBang("!yt cats", allBangs())).toMatchObject({
      bang: { trigger: "yt" },
      query: "cats",
    });
    expect(parseLeadingBang("!F report", allBangs())).toMatchObject({
      bang: { trigger: "files" },
      query: "report",
    });
    expect(parseLeadingBang("!yt", allBangs())).toBeNull();
  });

  it("reads a trailing shortcut only on submit", () => {
    expect(parseLeadingBang("rust traits !rs", allBangs())).toBeNull();
    expect(parseBang("rust traits !rs", allBangs())).toMatchObject({
      bang: { trigger: "rs" },
      query: "rust traits",
    });
  });

  it("keeps unknown shortcuts and paths as plain text", () => {
    expect(parseBang("!nope cats", allBangs())).toBeNull();
    expect(parseBang("cats !nope", allBangs())).toBeNull();
    expect(parseBang("/usr/bin", allBangs())).toBeNull();
    expect(parseBang("/files report", allBangs())).toBeNull();
  });

  it("suggests shortcuts by name, then by label", () => {
    expect(matchingBangs("!", allBangs())).toHaveLength(allBangs().length);
    expect(matchingBangs("!boo", allBangs()).map((bang) => bang.trigger)).toEqual(["bookmarks"]);
    expect(matchingBangs("!you", allBangs()).map((bang) => bang.trigger)).toEqual(["yt"]);
    expect(matchingBangs("cats", allBangs())).toEqual([]);
  });
});

describe("bang destinations", () => {
  it("fills the query in, or opens the site without one", () => {
    expect(bangDestination(web("yt"), "lo fi")).toBe(
      "https://www.youtube.com/results?search_query=lo%20fi",
    );
    expect(bangDestination(web("gh"), "  ")).toBe("https://github.com/");
    expect(bangDestination(web("ddg"), "misty")).toBe("https://duckduckgo.com/?q=misty");
  });

  it("refuses a template that is not http or https", () => {
    const bang = { ...web("yt"), url: "javascript:alert(%s)" };
    expect(bangDestination(bang, "1")).toBeNull();
  });
});

describe("custom bangs", () => {
  it("override a built-in site but never a Misty place", () => {
    configureBrowserCustomBangs(
      JSON.stringify([
        { trigger: "yt", name: "Invidious", url: "https://yewtu.be/search?q=%s" },
        { trigger: "files", name: "Files site", url: "https://example.com/?q=%s" },
        { trigger: "jira", name: "Jira", url: "https://jira.example.com/search?q=%s" },
      ]),
    );
    const bangs = allBangs();
    expect(bangs.find((bang) => bang.trigger === "yt")).toMatchObject({ group: "custom" });
    expect(bangs.filter((bang) => bang.trigger === "files")).toMatchObject([{ kind: "scope" }]);
    expect(bangDestination(web("jira"), "BUG-1")).toBe("https://jira.example.com/search?q=BUG-1");
    expect(bangDestination(web("jira"), "")).toBe("https://jira.example.com/");
  });

  it("drops malformed, duplicate and unsafe entries from synced settings", () => {
    expect(
      parseBrowserCustomBangs(
        JSON.stringify([
          { trigger: "ok", name: "Ok", url: "https://ok.example/?q=%s" },
          { trigger: "ok", name: "Again", url: "https://again.example/?q=%s" },
          { trigger: "no slot", name: "Bad", url: "https://bad.example/" },
          { trigger: "js", name: "Script", url: "javascript:%s" },
          { trigger: "noquery", name: "No slot", url: "https://example.com/" },
          "nonsense",
        ]),
      ).map((bang) => bang.trigger),
    ).toEqual(["ok"]);
    expect(parseBrowserCustomBangs("not json")).toEqual([]);
  });
});
