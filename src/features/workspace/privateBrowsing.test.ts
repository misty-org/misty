import { describe, expect, it } from "vitest";
import { createBrowserTabState, parseBrowserTabState, type WorkspaceTab } from "./model";
import { isPrivateBrowserTab, privateTabTitle, scrubPrivateTab } from "./privateBrowsing";

const tab = (state: unknown): WorkspaceTab => ({
  id: "tab:1",
  surfaceId: "browser",
  groupKey: "tool:browser",
  instanceKey: "browser:1",
  title: "Secret page",
  route: "/browser",
  sidebarVisible: true,
  state,
  createdAt: 1,
  lastFocusedAt: 1,
});

describe("private browser tabs", () => {
  it("keeps the private flag through parsing", () => {
    const state = { ...createBrowserTabState("https://example.com/secret"), private: true };
    expect(parseBrowserTabState(state).private).toBe(true);
    expect(isPrivateBrowserTab(tab(state))).toBe(true);
    expect(isPrivateBrowserTab(tab(createBrowserTabState("https://example.com")))).toBe(false);
  });

  it("never lets a private tab's page or title leave the app", () => {
    const scrubbed = scrubPrivateTab(
      tab({ ...createBrowserTabState("https://example.com/secret"), private: true }),
    );
    expect(scrubbed.title).toBe(privateTabTitle);
    expect(JSON.stringify(scrubbed)).not.toContain("example.com");
    expect(isPrivateBrowserTab(scrubbed)).toBe(true);
  });

  it("leaves ordinary tabs untouched", () => {
    const ordinary = tab(createBrowserTabState("https://example.com"));
    expect(scrubPrivateTab(ordinary)).toBe(ordinary);
  });
});
