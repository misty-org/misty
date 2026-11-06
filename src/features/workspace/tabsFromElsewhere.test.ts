import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./profileWindow", () => ({ currentProfile: () => ({ id: "personal" }) }));

import { isFromElsewhere, keepFromElsewhere, markFromElsewhere } from "./tabsFromElsewhere";

describe("tabs from elsewhere", () => {
  beforeEach(() => localStorage.clear());

  it("remembers pages that arrived, so they sleep after a restart too", () => {
    expect(isFromElsewhere("view")).toBe(false);
    markFromElsewhere(["view"]);
    expect(isFromElsewhere("view")).toBe(true);
    expect(isFromElsewhere("opened-here")).toBe(false);
  });

  it("forgets pages no longer in the window", () => {
    markFromElsewhere(["kept", "closed"]);
    keepFromElsewhere(["kept", "opened-here"]);
    expect(isFromElsewhere("kept")).toBe(true);
    expect(isFromElsewhere("closed")).toBe(false);
    expect(isFromElsewhere("opened-here")).toBe(false);
  });

  it("treats unreadable storage as nothing remembered", () => {
    localStorage.setItem("misty.tabs.from-elsewhere.personal", "not json");
    expect(isFromElsewhere("view")).toBe(false);
  });
});
