import { describe, expect, it } from "vitest";
import { createBrowserViewState, parseBrowserViewState, type WorkspaceView } from "./model";
import { isPrivateBrowserView, privateViewTitle, scrubPrivateView } from "./privateBrowsing";

const tab = (state: unknown): WorkspaceView => ({
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
    const state = { ...createBrowserViewState("https://example.com/secret"), private: true };
    expect(parseBrowserViewState(state).private).toBe(true);
    expect(isPrivateBrowserView(tab(state))).toBe(true);
    expect(isPrivateBrowserView(tab(createBrowserViewState("https://example.com")))).toBe(false);
  });

  it("never lets a private tab's page or title leave the app", () => {
    const scrubbed = scrubPrivateView(
      tab({ ...createBrowserViewState("https://example.com/secret"), private: true }),
    );
    expect(scrubbed.title).toBe(privateViewTitle);
    expect(JSON.stringify(scrubbed)).not.toContain("example.com");
    expect(isPrivateBrowserView(scrubbed)).toBe(true);
  });

  it("leaves ordinary tabs untouched", () => {
    const ordinary = tab(createBrowserViewState("https://example.com"));
    expect(scrubPrivateView(ordinary)).toBe(ordinary);
  });
});
