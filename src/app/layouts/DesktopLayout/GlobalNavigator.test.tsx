import { MemoryRouter } from "react-router-dom";
import { act, cleanup, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useActivityStore } from "@/features/activity";
import { activeLayoutView, allLayoutViews, useWorkspaceStore } from "@/features/workspace";
import { createBookmarkFolder, saveBookmark } from "@/features/bookmarks/library";
import { useBrowserSearchStore } from "@/features/browser-workspace/search";
import { GlobalNavigator } from "./GlobalNavigator";
import type { DockPosition } from "@/features/app-shell/dockingLayout";
import { useSettingsProfiles } from "@/features/settings/profiles/store";
import { editPreference, initialProfileState } from "@/features/settings/profiles/model";

vi.mock("@/features/auth", () => ({
  useAuth: () => ({ user: { id: "account-1", email: "owner@example.com" }, accounts: [] }),
  useAccountAvatarUrl: () => null,
  useUserStore: (selector: (state: { me: null }) => unknown) => selector({ me: null }),
}));
const workspace = () => useWorkspaceStore.getState();
const initialSettings = useSettingsProfiles.getState();
const saveOrder = vi.fn(async (id: string, value: string) => {
  useSettingsProfiles.setState((store) => ({
    state: editPreference(store.state!, id, value, crypto.randomUUID()),
  }));
});
function renderNavigator(position: DockPosition = "left") {
  return render(
    <MemoryRouter>
      <GlobalNavigator
        position={position}
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
  useSettingsProfiles.setState({
    accountId: "account-1",
    ready: true,
    state: initialProfileState({}),
    edit: saveOrder,
  });
  saveOrder.mockClear();
});
afterEach(() => {
  cleanup();
  useSettingsProfiles.setState(initialSettings);
  vi.restoreAllMocks();
});

const destinationOrder = () =>
  [...document.querySelectorAll<HTMLElement>(".misty-navigator-items > [data-reorder-item]")].map(
    (item) => item.dataset.reorderItem,
  );

function pointer(element: EventTarget, type: string, x: number, y: number) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
    buttons: type === "pointerup" ? 0 : 1,
  });
  Object.defineProperties(event, { pointerId: { value: 1 }, isPrimary: { value: true } });
  act(() => element.dispatchEvent(event));
}

describe("navigation reordering", () => {
  it("saves keyboard moves without navigating or toggling a tray, survives remounts and isolates accounts", async () => {
    const ui = renderNavigator();
    const files = screen.getByRole("button", { name: "Files" });
    files.focus();
    const before = workspace().layout;
    fireEvent.keyDown(files, { key: "ArrowUp", altKey: true, shiftKey: true });
    await waitFor(() =>
      expect(destinationOrder()).toEqual([
        "home",
        "browser",
        "files",
        "agents",
        "extensions",
        "spaces",
      ]),
    );
    expect(saveOrder).toHaveBeenCalledWith(
      "collections.tabs.navigator",
      '["home","browser","files","agents","extensions","spaces"]',
    );
    expect(document.activeElement).toBe(files);
    expect(files.getAttribute("aria-expanded")).toBe("true");
    expect(workspace().layout).toBe(before);
    ui.unmount();
    renderNavigator();
    expect(destinationOrder()[2]).toBe("files");
    act(() =>
      useSettingsProfiles.setState({ accountId: "account-2", state: initialProfileState({}) }),
    );
    expect(destinationOrder()).toEqual([
      "home",
      "browser",
      "agents",
      "files",
      "extensions",
      "spaces",
    ]);
  });

  it.each(["left", "right", "top", "bottom"] as const)(
    "drags a main destination in the %s navbar without activating it",
    async (position) => {
      const vertical = position === "left" || position === "right";
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
        this: HTMLElement,
      ) {
        const item = this.closest<HTMLElement>("[data-reorder-item]");
        if (!item) return new DOMRect(0, 0, 600, 600);
        const index = [...item.parentElement!.children].indexOf(item);
        return new DOMRect(vertical ? 0 : index * 40, vertical ? index * 40 : 0, 40, 40);
      });
      renderNavigator(position);
      const home = screen.getByRole("link", { name: "Home" });
      const before = workspace().layout;
      pointer(home, "pointerdown", 10, 10);
      pointer(window, "pointermove", vertical ? 10 : 110, vertical ? 110 : 10);
      expect(saveOrder).not.toHaveBeenCalled();
      expect(document.querySelector(".pointer-reorder-indicator")).toBeTruthy();
      pointer(window, "pointerup", vertical ? 10 : 110, vertical ? 110 : 10);
      fireEvent.click(home, { detail: 1 });
      await waitFor(() =>
        expect(destinationOrder().slice(0, 3)).toEqual(["browser", "agents", "home"]),
      );
      expect(workspace().layout).toBe(before);
      expect(document.querySelector(".pointer-reorder-shield")).toBeNull();
    },
  );

  it("leaves child destinations and fixed utilities out of reordering", () => {
    renderNavigator();
    for (const name of ["Explorer", "Transfers", "Search", "Create Space"])
      fireEvent.keyDown(
        screen.getByRole(name === "Explorer" || name === "Transfers" ? "link" : "button", { name }),
        { key: "ArrowUp", altKey: true, shiftKey: true },
      );
    expect(saveOrder).not.toHaveBeenCalled();
    expect(
      screen.getByRole("link", { name: "Explorer" }).closest("[data-reorder-handle]"),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Search" }).closest("[data-reorder-item]"),
    ).toBeNull();
  });

  it("reports save failures and preserves the saved order", async () => {
    useSettingsProfiles.setState({ edit: vi.fn().mockRejectedValue(new Error("Unavailable")) });
    renderNavigator();
    fireEvent.keyDown(screen.getByRole("link", { name: "Browser" }), {
      key: "ArrowUp",
      altKey: true,
      shiftKey: true,
    });
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Navigation order couldn’t be saved",
    );
    expect(destinationOrder()[0]).toBe("home");
  });

  it("does not reorder until account settings are ready", () => {
    useSettingsProfiles.setState({ ready: false });
    renderNavigator();
    fireEvent.keyDown(screen.getByRole("link", { name: "Browser" }), {
      key: "ArrowUp",
      altKey: true,
      shiftKey: true,
    });
    expect(saveOrder).not.toHaveBeenCalled();
  });
});

describe("browser workspace navigator", () => {
  it("shows Agents as the home for schedules", () => {
    const folder = createBookmarkFolder("Reading");
    saveBookmark({ title: "Example", url: "example.com", folderId: folder });
    renderNavigator();
    const nav = screen.getByRole("navigation", { name: "Primary" });
    for (const name of ["Home", "Browser", "Agents", "Explorer", "Transfers"])
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
      "Explorer",
      "Transfers",
    ]);
    expect(pages[0].closest(".misty-navigator-items")).toBeTruthy();
    for (const name of ["Home", "Browser", "Agents", "Explorer", "Transfers"])
      expect(
        within(nav).getByRole("link", { name }).hasAttribute("data-navigation-destination"),
      ).toBe(true);
    expect(
      within(nav)
        .getByRole("button", { name: "Search" })
        .hasAttribute("data-navigation-destination"),
    ).toBe(false);
  });
  it("keeps schedules inside Agents rather than a separate global destination", () => {
    renderNavigator();
    expect(screen.queryByRole("link", { name: "Scheduled" })).toBeNull();
    fireEvent.click(screen.getByRole("link", { name: "Agents" }));
    expect(activeLayoutView(workspace().layout)).toMatchObject({
      surfaceId: "agents",
      route: "/agents",
    });
  });
  it("opens Explorer inside the Files group", () => {
    renderNavigator();
    fireEvent.click(screen.getByRole("link", { name: "Explorer" }));
    expect(activeLayoutView(workspace().layout)).toMatchObject({
      surfaceId: "files",
      groupKey: "tool:files",
      route: "/files",
    });
    expect(screen.getByRole("link", { name: "Explorer" }).getAttribute("aria-current")).toBe(
      "page",
    );
  });
  it("opens Transfers separately and resumes the matching Files destination", () => {
    const folder = workspace().openSurface({
      surfaceId: "files",
      groupKey: "tool:files",
      title: "Projects",
      route: "/files?path=Projects",
      state: { path: "/Projects" },
    });
    renderNavigator();
    fireEvent.click(screen.getByRole("link", { name: "Transfers" }));
    const transfer = activeLayoutView(workspace().layout)!;
    expect(transfer).toMatchObject({
      surfaceId: "files",
      title: "Transfers",
      route: "/files?view=transfers",
      state: { path: "misty-transfers://history" },
    });
    expect(transfer.id).not.toBe(folder.id);
    expect(screen.getByRole("link", { name: "Transfers" }).getAttribute("aria-current")).toBe(
      "page",
    );
    fireEvent.click(screen.getByRole("link", { name: "Explorer" }));
    expect(activeLayoutView(workspace().layout)?.id).toBe(folder.id);
    fireEvent.click(screen.getByRole("link", { name: "Transfers" }));
    expect(activeLayoutView(workspace().layout)?.id).toBe(transfer.id);
    expect(
      allLayoutViews(workspace().layout).filter((tab) => tab.surfaceId === "files"),
    ).toHaveLength(2);
  });
  it("fills an explicit blank tab with Transfers", () => {
    workspace().openSurface({
      surfaceId: "files",
      groupKey: "tool:files",
      title: "Files",
      route: "/files",
    });
    workspace().newTab();
    const count = workspace().layout.tabs?.length;
    renderNavigator();
    fireEvent.click(screen.getByRole("link", { name: "Transfers" }));
    expect(activeLayoutView(workspace().layout)?.route).toBe("/files?view=transfers");
    expect(workspace().layout.tabs?.length).toBe(count);
  });
  it("collapses the Files destinations and retains the active group", () => {
    renderNavigator();
    fireEvent.click(screen.getByRole("link", { name: "Transfers" }));
    const toggle = screen.getByRole("button", { name: "Files" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("data-active")).toBe("true");
    expect(document.getElementById("navigator-files")?.hasAttribute("inert")).toBe(true);
    fireEvent.click(toggle);
    expect(document.getElementById("navigator-files")?.hasAttribute("inert")).toBe(false);
    expect(screen.getByRole("link", { name: "Transfers" }).getAttribute("aria-current")).toBe(
      "page",
    );
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
