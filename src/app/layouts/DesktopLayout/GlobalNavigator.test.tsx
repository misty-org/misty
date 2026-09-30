import { MemoryRouter } from "react-router-dom";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useActivityStore } from "@/features/activity";
import { activeLayoutView, useWorkspaceStore } from "@/features/workspace";
import { createBookmarkFolder, saveBookmark } from "@/features/bookmarks/library";
import { useBrowserSearchStore } from "@/features/browser-workspace/search";
import { GlobalNavigator } from "./GlobalNavigator";

vi.mock("@/features/auth", () => ({
  useAuth: () => ({ user: { id: "account-1", email: "owner@example.com" }, accounts: [] }),
  useAccountAvatarUrl: () => null,
  useUserStore: (selector: (state: { me: null }) => unknown) => selector({ me: null }),
}));
const workspace = () => useWorkspaceStore.getState();
function renderNavigator() {
  return render(
    <MemoryRouter>
      <GlobalNavigator
        profileOpen={false}
        settingsOpen={false}
        onProfileOpenChange={() => undefined}
        onOpenAccountSettings={() => undefined}
        onSettingsClick={() => {}}
      />
    </MemoryRouter>,
  );
}
beforeEach(() => {
  workspace().reset();
  useActivityStore.setState({ allItems: [] });
  useBrowserSearchStore.getState().close();
});
afterEach(cleanup);

describe("browser workspace navigator", () => {
  it("shows the primary destinations including Scheduled", () => {
    const folder = createBookmarkFolder("Reading");
    saveBookmark({ title: "Example", url: "example.com", folderId: folder });
    renderNavigator();
    const nav = screen.getByRole("navigation", { name: "Primary" });
    for (const name of ["Home", "Browser", "Agents", "Scheduled", "Files"])
      expect(within(nav).getByRole("link", { name })).toBeTruthy();
    expect(within(nav).getByRole("button", { name: "Spaces" })).toBeTruthy();
    expect(within(nav).queryByRole("heading", { name: "Groups" })).toBeNull();
    expect(within(nav).queryByRole("button", { name: "Configure groups" })).toBeNull();
    expect(within(nav).queryByText("Reading")).toBeNull();
    expect(workspace().bookmarks).toHaveLength(1);
    const pages = within(nav).getAllByRole("link");
    expect(pages.slice(0, 5).map((page) => page.getAttribute("aria-label"))).toEqual([
      "Home",
      "Browser",
      "Agents",
      "Scheduled",
      "Files",
    ]);
    expect(pages[0].closest(".misty-navigator-items")).toBeTruthy();
    for (const name of ["Home", "Browser", "Agents", "Scheduled", "Files"])
      expect(
        within(nav).getByRole("link", { name }).hasAttribute("data-navigation-destination"),
      ).toBe(true);
    expect(
      within(nav)
        .getByRole("button", { name: "Search" })
        .hasAttribute("data-navigation-destination"),
    ).toBe(false);
  });
  it("opens Scheduled as its own reusable destination", () => {
    renderNavigator();
    fireEvent.click(screen.getByRole("link", { name: "Scheduled" }));
    const scheduled = activeLayoutView(workspace().layout)!;
    expect(scheduled).toMatchObject({ surfaceId: "scheduled", route: "/scheduled" });
    expect(screen.getByRole("link", { name: "Scheduled" }).getAttribute("aria-current")).toBe(
      "page",
    );
    fireEvent.click(screen.getByRole("link", { name: "Agents" }));
    fireEvent.click(screen.getByRole("link", { name: "Scheduled" }));
    expect(activeLayoutView(workspace().layout)?.id).toBe(scheduled.id);
  });
  it("opens Files directly as a global tool", () => {
    renderNavigator();
    fireEvent.click(screen.getByRole("link", { name: "Files" }));
    expect(activeLayoutView(workspace().layout)).toMatchObject({
      surfaceId: "files",
      groupKey: "tool:files",
      route: "/files",
    });
    expect(screen.getByRole("link", { name: "Files" }).getAttribute("aria-current")).toBe("page");
  });
  it("opens the same global browser search from the navbar button", () => {
    renderNavigator();
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(useBrowserSearchStore.getState().open).toBe(true);
  });
  it("keeps Browser active for pages opened from bookmarks", () => {
    workspace().openBrowserView({ url: "https://example.com", bookmarkId: "legacy-bookmark" });
    renderNavigator();
    expect(screen.getByRole("link", { name: "Browser" }).getAttribute("aria-current")).toBe("page");
  });
});

it("reveals a portalled side hint on keyboard focus and dismisses it with Escape", async () => {
  renderNavigator();
  const activity = screen.getByRole("button", { name: /^Activity/ });
  fireEvent.focus(activity);
  const hint = await screen.findByRole("tooltip");
  expect(hint.textContent).toContain("Activity");
  expect(screen.getByRole("navigation").contains(hint)).toBe(false);
  expect(hint.closest("[data-navigation-tooltip]")?.getAttribute("data-side")).toBe("right");
  fireEvent.keyDown(activity, { key: "Escape" });
  expect(screen.queryByRole("tooltip")).toBeNull();
});
