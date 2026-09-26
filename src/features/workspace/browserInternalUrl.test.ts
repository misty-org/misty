import { describe, expect, it } from "vitest";
import { normalizeBrowserAddress } from "@/features/browser-workspace/address";
import { browserInternalPage, browserInternalUrl, isBrowserInternalUrl } from "./browserInternalUrl";
import { browserTabTitle } from "./model";

describe("browser internal pages", () => {
  it("recognizes Misty's own pages regardless of case or a trailing slash", () => {
    expect(browserInternalPage("misty://history")).toBe("history");
    expect(browserInternalPage("MISTY://Downloads/")).toBe("downloads");
    expect(browserInternalPage("misty://constructor")).toBeNull();
    expect(browserInternalPage("misty://history/extra")).toBeNull();
    expect(isBrowserInternalUrl("https://history.example")).toBe(false);
  });

  it("opens internal pages from the address bar instead of searching for them", () => {
    expect(normalizeBrowserAddress("misty://bookmarks/")).toBe(browserInternalUrl("bookmarks"));
    expect(normalizeBrowserAddress("misty://nope")).toContain("nope");
  });

  it("titles internal tabs by page name", () => {
    expect(browserTabTitle("misty://extensions")).toBe("Extensions");
  });
});
