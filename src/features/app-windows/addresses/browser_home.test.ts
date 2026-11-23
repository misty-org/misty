import { describe, expect, it } from "vitest";
import { browserHomeUrl } from "./browser_home";
import { blankBrowserUrl } from "./browser_url";

describe("agent page home", () => {
  it("opens a blank page when nothing asked for a URL", () => {
    expect(browserHomeUrl()).toBe(blankBrowserUrl);
  });
});
