import { useActivityStore } from "@/features/activity";
import { useSpacesStore } from "@/features/spaces";
import { useWorkspaceStore, type WorkspaceTab } from "@/features/workspace";
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GlobalNavigator } from "./GlobalNavigator";

vi.mock("@/features/auth", () => ({
  useAuth: () => ({ user: { id: "account-1", email: "owner@example.com" } }),
  useAccountAvatarUrl: () => null,
  useUserStore: (selector: (state: { me: null }) => unknown) => selector({ me: null }),
}));

describe("GlobalNavigator Space tools", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    useActivityStore.setState({ allItems: [] });
    useSpacesStore.setState({
      spaces: [spaceFixture],
      invitations: [],
      limits: null,
      presenceBySpace: {
        "space-1": [{ user_id: "account-1", active: true }],
      },
    });
    useWorkspaceStore.getState().reset();
    useWorkspaceStore.setState({
      activeScopeKey: "space:space-1",
      layout: {
        focusedPaneId: "pane-1",
        root: {
          type: "leaf",
          id: "pane-1",
          activeTabId: "tab-1",
          tabs: [spaceTab],
        },
      },
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.body.innerHTML = "";
    useSpacesStore.setState({ spaces: [], invitations: [], presenceBySpace: {} });
    useActivityStore.setState({ allItems: [] });
    useWorkspaceStore.getState().reset();
  });

  it("places contextual Space surfaces beside the other tools", async () => {
    await renderNavigator();

    const tools = container.querySelector('section[aria-label="Tools"]');
    expect(
      [...tools!.querySelectorAll("a")].map((link) => link.getAttribute("aria-label")),
    ).toEqual([
      "Journal",
      "Planner",
      "Chat",
      "Library",
      "Browser",
      "Terminal",
      "Code",
      "Files",
      "Transfers",
      "Agents",
      "Extensions",
    ]);
    expect(tools?.querySelector('a[aria-label="Journal"]')?.getAttribute("aria-current")).toBe(
      "page",
    );
  });

  it("keeps Space names visible and exposes one hover action menu per row", async () => {
    await renderNavigator();

    const spaces = container.querySelector('section[aria-label="Spaces"]');
    const spaceLink = spaces?.querySelector('a[aria-label="Family"]');
    expect(spaces?.querySelector('a[aria-label="Family"]')?.getAttribute("aria-current")).toBe(
      "page",
    );
    expect(spaceLink?.textContent).toContain("Family");
    // The three row actions are always mounted; the row reveals them on hover
    // with opacity, so they must be present in the tree, not conditionally rendered.
    expect(spaces?.querySelector('button[aria-label="Family usage"]')).not.toBeNull();
    expect(spaces?.querySelector('button[aria-label="Family team"]')).not.toBeNull();
    expect(spaces?.querySelector('a[aria-label="Family settings"]')).not.toBeNull();
    expect(spaces?.querySelector('button[aria-label="Family actions"]')).toBeNull();
    expect(spaces?.querySelector(".bg-status-green")).toBeNull();
    expect(spaces?.querySelector(".bg-sage-fg")).toBeNull();
  });

  it("opens Usage straight from the Space row without an intermediate menu", async () => {
    await renderNavigator();

    const spaces = container.querySelector('section[aria-label="Spaces"]');
    const usage = spaces?.querySelector<HTMLButtonElement>('button[aria-label="Family usage"]');
    // Popover opens on click; the old ellipsis was a DropdownMenu, which
    // opened on pointerdown.
    await act(async () => usage?.click());

    // One interaction, not two: there is no menu between the row and the popover.
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
    expect(document.body.textContent).toContain("Your weekly AI allowance and storage pool");
  });

  it("points the Space settings action at that Space's settings route", async () => {
    await renderNavigator();

    const spaces = container.querySelector('section[aria-label="Spaces"]');
    const settings = spaces?.querySelector('a[aria-label="Family settings"]');
    expect(settings?.getAttribute("href")).toContain("/settings/general");
  });

  it("scrolls Spaces and Tools independently without visible scrollbar chrome", async () => {
    await renderNavigator();

    const spaces = container.querySelector('[data-navigator-section-scroll="spaces"]');
    const tools = container.querySelector('[data-navigator-section-scroll="tools"]');
    for (const section of [spaces, tools]) {
      expect(section?.className).toContain("overflow-y-auto");
      expect(section?.className).toContain("[scrollbar-width:none]");
      expect(section?.className).toContain("[&::-webkit-scrollbar]:hidden");
    }
  });

  it("keeps the Space context while one of its other tool tabs is focused", async () => {
    useWorkspaceStore.setState({
      layout: {
        focusedPaneId: "pane-1",
        root: {
          type: "leaf",
          id: "pane-1",
          activeTabId: "browser-tab",
          tabs: [spaceTab, browserTab],
        },
      },
    });
    await renderNavigator("/browser");

    const spaces = container.querySelector('section[aria-label="Spaces"]');
    const tools = container.querySelector('section[aria-label="Tools"]');
    expect(spaces?.querySelector('a[aria-label="Family"]')?.getAttribute("aria-current")).toBe(
      "page",
    );
    expect(tools?.querySelector('a[aria-label="Browser"]')?.getAttribute("aria-current")).toBe(
      "page",
    );
    expect(tools?.querySelector('a[aria-label="Journal"]')).not.toBeNull();
  });

  async function renderNavigator(initialEntry = "/spaces/space-1/notes") {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[initialEntry]}>
          <GlobalNavigator
            collapsed={false}
            mistyLogoSource={null}
            profileAnchorRef={createRef<HTMLButtonElement>()}
            profileOpen={false}
            settingsOpen={false}
            onProfileClick={() => undefined}
            onSettingsClick={() => undefined}
          />
        </MemoryRouter>,
      );
    });
  }
});

const spaceFixture = {
  id: "space-1",
  owner_user_id: "account-1",
  name: "Family",
  role: "owner" as const,
  member_count: 1,
  pending_count: 0,
  is_shared: true,
  created_at: "2026-08-17T00:00:00Z",
  updated_at: "2026-08-17T00:00:00Z",
};

const spaceTab: WorkspaceTab = {
  id: "tab-1",
  surfaceId: "space",
  groupKey: "space:space-1",
  instanceKey: "space-1",
  title: "Family",
  route: "/spaces/space-1/notes",
  sidebarVisible: true,
  state: {},
  createdAt: 1,
  lastFocusedAt: 1,
};

const browserTab: WorkspaceTab = {
  id: "browser-tab",
  surfaceId: "browser",
  groupKey: "tool:browser",
  instanceKey: "browser-tab",
  title: "Browser",
  route: "/browser",
  sidebarVisible: true,
  state: { version: 1, url: "https://www.google.com", faviconUrl: null },
  createdAt: 2,
  lastFocusedAt: 2,
};
