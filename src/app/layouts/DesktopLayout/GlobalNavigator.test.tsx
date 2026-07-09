import { createRef } from "react";
import { MemoryRouter } from "react-router-dom";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useActivityStore } from "@/features/activity";
import { activeLayoutView, useWorkspaceStore } from "@/features/workspace";
import { addWebsite } from "@/features/browser-workspace/navigation";
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
    for (const name of ["Inbox", "Social", "Journal", "Planner", "Library"])
      expect(within(nav).getByRole("button", { name })).toBeTruthy();
    expect(within(nav).getByRole("link", { name: "Home" })).toBeTruthy();
    expect(within(nav).getByRole("link", { name: "Spaces" })).toBeTruthy();
    expect(within(nav).getByRole("link", { name: "Files" }).compareDocumentPosition(within(nav).getByRole("button", { name: "Inbox" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(nav).getByRole("link", { name: "Agents" })).toBeTruthy();
    expect(within(nav).queryByRole("heading", { name: /apps|groups|categories/i })).toBeNull();
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
  it("expands a group independently of its website picker without navigating", () => {
    addWebsite("group:default:inbox", "Example mail", "https://mail.example");
    renderNavigator();
    const before = workspace().layout;
    const expand = screen.getByRole("button", { name: "Inbox" });
    fireEvent.click(expand);
    expect(expand.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Integrations for Inbox" }));
    expect(screen.getByRole("textbox", { name: "Search integrations" })).toBeTruthy();
    expect(expand.getAttribute("aria-expanded")).toBe("false");
    expect(workspace().layout).toBe(before);
  });
  it("adds an arbitrary website to a group through its own dropdown", () => {
    renderNavigator();
    fireEvent.click(screen.getByRole("button", { name: "Integrations for Social" }));
    fireEvent.click(screen.getByRole("button", { name: "Add your own website" }));
    fireEvent.change(screen.getByLabelText("Website address"), {
      target: { value: "https://drive.google.com/" },
    });
    fireEvent.change(screen.getByLabelText("Name (optional)"), { target: { value: "Drive" } });
    fireEvent.click(screen.getByRole("button", { name: "Add website" }));
    expect(workspace().savedWebsites).toContainEqual(
      expect.objectContaining({
        fields: expect.objectContaining({
          title: "Drive",
          group_id: "group:default:social",
          url: "https://drive.google.com/",
        }),
      }),
    );
    expect(activeLayoutView(workspace().layout)?.surfaceId).toBe("browser");
    expect(screen.queryByRole("textbox", { name: "Website address" })).toBeNull();
  });
  it("creates and reorders a custom group without reopening the focused page", () => {
    renderNavigator();
    fireEvent.click(screen.getByRole("button", { name: "New group" }));
    fireEvent.change(screen.getByLabelText("Group name"), { target: { value: "Research" } });
    fireEvent.click(screen.getByRole("button", { name: "Create group" }));
    const before = workspace().layout;
    const research = screen.getByRole("button", { name: "Research" });
    fireEvent.keyDown(research, { key: "ArrowUp", altKey: true, shiftKey: true });
    expect(workspace().websiteGroups.map((group) => group.fields.label)).toEqual([
      "Inbox",
      "Social",
      "Journal",
      "Planner",
      "Research",
      "Library",
    ]);
    expect(workspace().layout).toBe(before);
  });
  it("saves the current page separately from its live browser tab", () => {
    const tab = workspace().openBrowserTab({ url: "https://example.com/start" });
    renderNavigator();
    fireEvent.click(screen.getByRole("button", { name: "Save current page to group" }));
    const inbox = screen.getAllByRole("button", { name: "Inbox" });
    fireEvent.click(inbox[inbox.length - 1]);
    act(() => workspace().updateBrowserTab(tab.id, { url: "https://example.com/next" }));
    expect(workspace().savedWebsites[0].fields.url).toBe("https://example.com/start");
  });
  it("opens the same global browser search from the navbar button", () => {
    renderNavigator();
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(useBrowserSearchStore.getState().open).toBe(true);
  });
  it("marks the focused saved website, keeping Home inactive", () => {
    addWebsite("group:default:inbox", "Example", "https://example.com");
    renderNavigator();
    fireEvent.click(screen.getByRole("button", { name: "Example" }));
    expect(screen.getByRole("link", { name: "Home" }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("button", { name: "Example" }).getAttribute("aria-current")).toBe(
      "page",
    );
  });
});
