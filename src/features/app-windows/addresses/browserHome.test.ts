import { describe, expect, it } from "vitest";
import { browserHomeUrl } from "./browserHome";
import { blankBrowserUrl } from "./browserUrl";

describe("agent page home", () => {
  it("opens a blank page when nothing asked for a URL", () => {
    expect(browserHomeUrl()).toBe(blankBrowserUrl);
  });
});
