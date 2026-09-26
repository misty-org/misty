import { createRef } from "react";
import { MemoryRouter } from "react-router-dom";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useActivityStore } from "@/features/activity";
import { activeLayoutView, useWorkspaceStore } from "@/features/workspace";
import { addWebsite, createWebsiteGroup } from "@/features/browser-workspace/navigation";
import { useBrowserSearchStore } from "@/features/browser-workspace/search";
import { GlobalNavigator } from "./GlobalNavigator";

vi.mock("@/features/auth", () => ({
  useAuth: () => ({ user: { id: "account-1", email: "owner@example.com" } }),
  useAccountAvatarUrl: () => null,
  useUserStore: (selector: (state: { me: null }) => unknown) => selector({ me: null }),
}));
const workspace = () => useWorkspaceStore.getState();
function renderNavigator() {
  return render(
    <MemoryRouter>
      <GlobalNavigator
        profileAnchorRef={createRef()}
        profileOpen={false}
        settingsOpen={false}
        onProfileClick={() => {}}
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
  it("shows global tools above personal website groups", () => {
    renderNavigator();
    const nav = screen.getByRole("navigation", { name: "Primary" });
    for (const name of ["Home", "Agents", "Files", "Spaces"])
      expect(within(nav).getByRole("link", { name })).toBeTruthy();
    expect(within(nav).getByRole("heading", { name: "Groups" })).toBeTruthy();
    expect(within(nav).getByRole("button", { name: "Configure groups" })).toBeTruthy();
    expect(workspace().websiteGroups).toEqual([]);
    expect(within(nav).queryByRole("link", { name: "Discover" })).toBeNull();
    expect(within(nav).queryByRole("button", { name: /switch space/i })).toBeNull();
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
  it("expands a user group independently of configuration without navigating", () => {
    const id = createWebsiteGroup("Reading");
    addWebsite(id, "Example mail", "https://mail.example");
    renderNavigator();
    const before = workspace().layout;
    const expand = screen.getByRole("button", { name: "Reading" });
    fireEvent.click(expand);
    expect(expand.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Configure groups" }));
    expect(screen.getByRole("dialog", { name: "Groups" })).toBeTruthy();
    expect(expand.getAttribute("aria-expanded")).toBe("false");
    expect(workspace().layout).toBe(before);
  });
  it("adds an arbitrary website through Configure", () => {
    const id = createWebsiteGroup("Work");
    renderNavigator();
    const before = workspace().layout;
    fireEvent.click(screen.getByRole("button", { name: "Configure groups" }));
    fireEvent.click(screen.getByRole("button", { name: "Add site to group" }));
    fireEvent.change(screen.getByLabelText("Site URL"), {
      target: { value: "https://drive.google.com/" },
    });
    fireEvent.change(screen.getByLabelText("Site name (optional)"), { target: { value: "Drive" } });
    fireEvent.click(screen.getByRole("button", { name: "Add site" }));
    expect(workspace().savedWebsites).toContainEqual(
      expect.objectContaining({
        fields: expect.objectContaining({
          title: "Drive",
          group_id: id,
          url: "https://drive.google.com/",
        }),
      }),
    );
    expect(workspace().layout).toBe(before);
  });
  it("creates and reorders a custom group without reopening the focused page", () => {
    createWebsiteGroup("Reading");
    renderNavigator();
    fireEvent.click(screen.getByRole("button", { name: "Configure groups" }));
    fireEvent.click(screen.getByRole("button", { name: "Add group" }));
    fireEvent.change(screen.getByLabelText("New group name"), { target: { value: "Research" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    const before = workspace().layout;
    fireEvent.keyDown(screen.getByRole("button", { name: "Research" }), {
      key: "ArrowUp",
      altKey: true,
      shiftKey: true,
    });
    expect(workspace().websiteGroups.map((group) => group.fields.label)).toEqual([
      "Research",
      "Reading",
    ]);
    expect(workspace().layout).toBe(before);
  });
  it("opens the same global browser search from the navbar button", () => {
    renderNavigator();
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(useBrowserSearchStore.getState().open).toBe(true);
  });
  it("marks the focused saved website, keeping Home inactive", () => {
    addWebsite(createWebsiteGroup("Reading"), "Example", "https://example.com");
    renderNavigator();
    fireEvent.click(screen.getByRole("button", { name: "Example" }));
    expect(screen.getByRole("link", { name: "Home" }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("button", { name: "Example" }).getAttribute("aria-current")).toBe(
      "page",
    );
  });
});
