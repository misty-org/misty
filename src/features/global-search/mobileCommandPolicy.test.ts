import { describe, expect, it } from "vitest";
import { mobileCommandAllowed } from "./unifiedMistyCandidates";

describe("mobile launcher command policy", () => {
  it("hides desktop layout and extension commands", () => {
    expect(mobileCommandAllowed("workspace.split_right", "Tabs and panes")).toBe(false);
    expect(mobileCommandAllowed("workspace.new_virtual_window", "Virtual windows")).toBe(false);
    expect(mobileCommandAllowed("extension.example.open", "Extensions")).toBe(false);
    expect(mobileCommandAllowed("marketplace.open", "Store")).toBe(false);
  });

  it("keeps supported and handoff tools discoverable", () => {
    expect(mobileCommandAllowed("tool.browser", "Jump to tool")).toBe(true);
    expect(mobileCommandAllowed("tool.code", "Jump to tool")).toBe(true);
  });
});
