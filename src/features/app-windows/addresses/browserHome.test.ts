import { describe, expect, it } from "vitest";
import { browserHomeUrl } from "./browserHome";
import { blankBrowserUrl } from "./browserUrl";
import { createBrowserViewState } from "../tabs/workspaceViews";

describe("agent page home", () => {
  it("opens a blank page when nothing asked for a URL", () => {
    expect(browserHomeUrl()).toBe(blankBrowserUrl);
    expect(createBrowserViewState().url).toBe(blankBrowserUrl);
  });
});
