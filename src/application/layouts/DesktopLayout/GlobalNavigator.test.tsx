import { useAppsStore } from "@/features/apps";
import { useActivityStore } from "@/features/activity";
import { useGlobalSearchStore } from "@/features/global-search";
import { useSpacesStore } from "@/features/spaces";
import {
  NAVIGATOR_APP_IDS,
  dockTabs,
  useNavigatorAppsStore,
  useWorkspaceStore,
} from "@/features/workspace";
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsStore } from "@/features/settings";
import { GlobalNavigator } from "./GlobalNavigator";
import {
  createAppNavigationRegistration,
  useAppNavigationStore,
} from "@/features/apps/appNavigation";
import { createAppRpcScope } from "@/features/apps/rpc/session";
import { executeAppCapability } from "@/features/apps/appCapabilityGateway";
import type { OfficialApp } from "@/api/apps";
import {
  browserTab,
  seedNavigatorApps,
  spaceFixture,
  spaceTab,
} from "./GlobalNavigator.testFixtures";

const desktopPetMocks = vi.hoisted(() => ({
  toggleDesktopMistyPanel: vi.fn(async () => false),
}));

vi.mock("@/features/desktop-pet", () => ({
  toggleDesktopMistyPanel: desktopPetMocks.toggleDesktopMistyPanel,
}));

vi.mock("@/features/auth", () => ({
  useAuth: () => ({ user: { id: "account-1", email: "owner@example.com" } }),
  useAccountAvatarUrl: () => null,
  useUserStore: (selector: (state: { me: null }) => unknown) => selector({ me: null }),
}));

const loadSpaces = useSpacesStore.getState().load;

describe("GlobalNavigator Space tools", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useAppNavigationStore.setState({ entries: [], providerCache: [] });
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    useActivityStore.setState({ allItems: [] });
    desktopPetMocks.toggleDesktopMistyPanel.mockReset().mockResolvedValue(false);
    useGlobalSearchStore.setState({ panel: "closed" });
    useSpacesStore.setState({
      spaces: [spaceFixture],
      invitations: [],
      limits: null,
      snapshotReady: true,
      loading: false,
      error: null,
      load: loadSpaces,
      presenceBySpace: {
        "space-1": [{ user_id: "account-1", active: true }],
      },
    });
    useWorkspaceStore.getState().reset();
    seedNavigatorApps();
    useNavigatorAppsStore.setState({
      appIdsByAccount: {},
      collapsedByAccount: { "account-1": false },
    });
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
    useSpacesStore.setState({
      spaces: [],
      invitations: [],
      presenceBySpace: {},
      snapshotReady: false,
      loading: false,
      error: null,
      load: loadSpaces,
    });
    useActivityStore.setState({ allItems: [] });
    useWorkspaceStore.getState().reset();
  });

  it("keeps selected apps in a stable order inside one Apps section", async () => {
    await renderNavigator();

    const tools = container.querySelector('[role="group"][aria-label="Apps"]');
    expect(
      [...tools!.querySelectorAll("a, button, [aria-disabled='true']")]
        .map((link) => link.getAttribute("aria-label"))
        .filter((label) =>
          NAVIGATOR_APP_IDS.some(
            (id) => (id === "library" ? "storage" : id) === label?.toLowerCase(),
          ),
        ),
    ).toEqual([
      "Inbox",
      "Social",
      "Journal",
      "Files",
      "Planner",
      "Storage",
      "Browser",
      "Code",
      "Terminal",
      "Music",
      "Media",
    ]);
    expect(container.querySelector('a[aria-label="Extensions"]')).toBeNull();
    expect(container.querySelector('a[aria-label="Transfers"]')).toBeNull();
    expect(tools).not.toBeNull();
    expect(tools?.querySelector('button[aria-label="Collapse Apps"]')).toBeNull();
    expect(tools?.querySelector("h2")?.textContent).toBe("Apps");
    expect(
      container.querySelector(
        'button[aria-label^="Switch Space"] [data-chevron-placement="inline"]',
      ),
    ).not.toBeNull();
    const disclosureToggles = [
      ...(tools?.querySelectorAll<HTMLButtonElement>(
        'button[data-navigator-disclosure-trigger="true"]',
      ) ?? []),
    ];
    expect(disclosureToggles).toHaveLength(11);
    expect(
      disclosureToggles.every((toggle) =>
        toggle.querySelector('[data-chevron-placement="inline"]'),
      ),
    ).toBe(true);
    expect(tools?.querySelector('[data-app-icon="home"]')).toBeNull();
    expect(tools?.querySelector('[data-app-icon="journal"]')).not.toBeNull();
    expect(tools?.querySelector('[data-app-icon="files"]')).not.toBeNull();
    expect(tools?.querySelector('[data-app-icon="planner"]')).not.toBeNull();
    expect(tools?.querySelector("h2")?.textContent).toContain("Apps");
    const profileBar = container.querySelector('[data-navigator-profile-bar="fixed"]');
    expect(profileBar?.className).toContain("shrink-0");
    expect(profileBar?.className).toContain("mb-2");
    expect(profileBar?.firstElementChild?.className).toContain("rounded-xl");
    expect(profileBar?.firstElementChild?.className).toContain("bg-charcoal-card");
    expect(
      container
        .querySelector(
          '[aria-label="Space"] [aria-label="Journal destinations"] a[aria-current="page"]',
        )
        ?.textContent?.trim(),
    ).toBe("Notes");
  });

  it("drags an entire app section from its header and saves the order without reopening pages", async () => {
    const settings = useSettingsStore.getState();
    const save = vi.fn((section: string, key: string, value: unknown) => {
      useSettingsStore.setState({
        settings: { document: { [section]: { [key]: value } } } as never,
      });
    });
    useSettingsStore.setState({ loaded: true, settings: null, updateSetting: save });
    const platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    await renderNavigator();
    const list = container.querySelector<HTMLElement>(
      '[data-reorder-list="navigator:account-1:sections"]',
    )!;
    const music = list.querySelector<HTMLElement>('[data-reorder-item="music"]')!;
    const header = music.querySelector<HTMLElement>("[data-reorder-handle]")!;
    const subtree = music.querySelector("[data-reorder-list]");
    const layout = useWorkspaceStore.getState().layout;
    const geometry = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this === list) return new DOMRect(0, 0, 240, 1000);
        const item = this.closest<HTMLElement>("[data-reorder-item]");
        const index = item ? [...list.children].indexOf(item) : 0;
        return new DOMRect(0, Math.max(0, index) * 80, 240, this === item ? 80 : 32);
      });
    const pointer = async (target: EventTarget, type: string, y: number) => {
      const event = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: 180,
        clientY: y,
        button: 0,
        buttons: type === "pointerup" ? 0 : 1,
      });
      Object.defineProperties(event, { pointerId: { value: 1 }, isPrimary: { value: true } });
      await act(async () => target.dispatchEvent(event));
    };
    try {
      // The complete primary button, including its empty space, is a handle.
      await pointer(header, "pointerdown", 570);
      await pointer(window, "pointermove", 5);
      const preview = document.querySelector(".pointer-reorder-preview")!;
      expect(preview.textContent).toBe("MusicConnect");
      expect(preview.querySelector('[data-app-icon="music"]')).not.toBeNull();
      expect(preview.querySelector("[data-reorder-list]")).toBeNull();
      await pointer(window, "pointerup", 5);
      expect(list.firstElementChild).toBe(music);
      expect(music.querySelector("[data-reorder-list]")).toBe(subtree);
      expect(useWorkspaceStore.getState().layout).toBe(layout);
      expect(save).toHaveBeenCalledWith(
        "navigation",
        "orders_by_account",
        expect.objectContaining({
          "account-1": expect.objectContaining({
            sections: [
              "music",
              "inbox",
              "social",
              "journal",
              "files",
              "planner",
              "library",
              "browser",
              "code",
              "terminal",
              "media",
            ],
          }),
        }),
      );
    } finally {
      geometry.mockRestore();
      platform.mockRestore();
      await act(async () => useSettingsStore.setState(settings));
    }
  });

  it("keeps Home, Discover, and Search separate from configurable apps", async () => {
    await renderNavigator();
    const navigation = container.querySelector(
      '[data-navigator-section-scroll="primary navigation"]',
    );
    expect(
      [
        ...navigation!.querySelectorAll(
          '[role="group"][aria-label="Apps"] a, [role="group"][aria-label="Apps"] button[data-navigator-disclosure-trigger="true"]',
        ),
      ]
        .slice(0, 3)
        .map((item) => item.getAttribute("aria-label")),
    ).toEqual(["Inbox", "Social", "Journal"]);

    const actions = container.querySelector('[aria-label="Global navigation"]');
    expect(
      [...actions!.querySelectorAll("a, button")].map((item) => item.getAttribute("aria-label")),
    ).toEqual(["Home", "Discover", "Agents"]);
    expect(actions?.querySelector('a[aria-label="Home"]')?.getAttribute("href")).toBe("/home");
    expect(actions?.querySelector('a[aria-label="Discover"]')?.getAttribute("href")).toBe(
      "/discover",
    );

    const searchButton = container.querySelector<HTMLButtonElement>(
      '[data-navigator-server-row="true"] button[aria-label="Search"]',
    );
    expect(searchButton).not.toBeNull();
    expect(
      container.querySelector('[data-navigator-server-row] button[aria-label="Activity"]'),
    ).not.toBeNull();
    const profileBar = container.querySelector("[data-navigator-profile-bar]");
    expect(profileBar?.querySelector('button[aria-label="Activity"]')).toBeNull();
    expect(profileBar?.querySelector('button[aria-label="Help"]')).not.toBeNull();

    await act(async () => {
      searchButton?.click();
      await vi.waitFor(() =>
        expect(desktopPetMocks.toggleDesktopMistyPanel).toHaveBeenCalledOnce(),
      );
    });
    expect(useGlobalSearchStore.getState().panel).toBe("results");
  });

  it("opens the floating Search and AI window when it is available", async () => {
    desktopPetMocks.toggleDesktopMistyPanel.mockResolvedValue(true);
    await renderNavigator();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-navigator-server-row="true"] button[aria-label="Search"]',
        )
        ?.click();
      await vi.waitFor(() =>
        expect(desktopPetMocks.toggleDesktopMistyPanel).toHaveBeenCalledOnce(),
      );
    });

    expect(useGlobalSearchStore.getState().panel).toBe("closed");
  });

  it("places global destinations above the Space selector and its apps", async () => {
    await renderNavigator();
    const global = container.querySelector('[aria-label="Global navigation"]')!;
    const switcher = container.querySelector(
      'button[aria-label="Switch Space, current Space: Family"]',
    )!;
    const apps = container.querySelector('[role="group"][aria-label="Apps"]')!;
    expect(
      global.compareDocumentPosition(switcher) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(switcher.compareDocumentPosition(apps) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(global.contains(switcher)).toBe(false);
    expect([...global.querySelectorAll("a")].map((item) => item.textContent)).toEqual([
      "Home",
      "Discover",
      "Agents",
    ]);
    expect(apps.querySelector('[aria-label="Agents"]')).toBeNull();
    expect(apps.querySelector('[aria-label="Storage"]')).not.toBeNull();
    expect(apps.querySelector('[aria-label="Library"]')).toBeNull();
    expect(
      container.querySelector('section[aria-label="Space"] [aria-label="Library"]'),
    ).not.toBeNull();
    expect(apps.textContent).not.toMatch(/Open (Browser|Files|Code|Gmail|Instagram)/);
    const personal = container.querySelector('[role="group"][aria-label="Apps"]')!;
    expect(
      switcher.compareDocumentPosition(personal) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    for (const name of ["Files", "Browser"]) {
      expect(personal.querySelector(`[aria-label="${name}"]`)).not.toBeNull();
      expect(apps.querySelector(`[aria-label="${name}"]`)).not.toBeNull();
    }
    expect(switcher.textContent).toContain("Family");
  });

  it("keeps Agents available when no apps are installed", async () => {
    useAppsStore.setState({ installations: [] });
    await renderNavigator();
    const link = container.querySelector('a[aria-label="Agents"]');
    expect(link?.getAttribute("href")).toBe("/apps/agents");
    await act(async () => (link as HTMLAnchorElement).click());
    expect(dockTabs(useWorkspaceStore.getState().layout.root)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ groupKey: "app:agents", route: "/apps/agents" }),
      ]),
    );
  });

  it("opens personal Files without retargeting the Space", async () => {
    await renderNavigator();
    const personal = container.querySelector('[role="group"][aria-label="Apps"]')!;
    expect(personal.querySelector('button[aria-label="Browser"]')).not.toBeNull();
    await act(async () =>
      personal.querySelector<HTMLButtonElement>('button[aria-label="Files"]')?.click(),
    );
    expect(useWorkspaceStore.getState().activeScopeKey).toBe("space:space-1");
    expect(dockTabs(useWorkspaceStore.getState().layout.root)).toEqual([
      expect.objectContaining({ groupKey: "app:files", route: "/apps/files" }),
    ]);
    const destinations = personal.querySelector('[aria-label="Files destinations"]')!;
    expect([...destinations.querySelectorAll("a")].map((item) => item.textContent)).toEqual([
      "Explorer",
      "Transfers",
    ]);
    expect(destinations.querySelector('a[aria-current="page"]')?.textContent).toBe("Explorer");
    await act(async () => (destinations.querySelectorAll("a")[1] as HTMLAnchorElement).click());
    expect(dockTabs(useWorkspaceStore.getState().layout.root)).toEqual([
      expect.objectContaining({ groupKey: "app:files", route: "/apps/files?view=transfers" }),
    ]);
    expect(destinations.querySelector('a[aria-current="page"]')?.textContent).toBe("Transfers");
    expect(useWorkspaceStore.getState().activeScopeKey).toBe("space:space-1");
  });

  it("expands Browser with account pins without leaking another Space’s destinations", async () => {
    useSpacesStore.setState({
      spaces: [
        { ...spaceFixture, is_default: true },
        { ...spaceFixture, id: "work", name: "Work" },
      ],
    });
    useAppNavigationStore.setState({
      providerCache: [
        {
          identity: { accountId: "account-1", spaceId: "", appId: "browser" },
          items: [
            { id: "bookmarks", label: "Personal bookmarks", route: "/apps/browser?view=bookmarks" },
          ],
        },
        {
          identity: { accountId: "account-1", spaceId: "work", appId: "browser" },
          items: [{ id: "other", label: "Space-only cache", route: "/apps/browser?view=other" }],
        },
      ],
    });
    useWorkspaceStore.getState().setScope("space:work");
    await renderNavigator("/home");
    await act(async () =>
      container.querySelector<HTMLButtonElement>('button[aria-label="Browser"]')?.click(),
    );
    const personal = container.querySelector('[role="group"][aria-label="Apps"]')!;
    expect(personal.textContent).toContain("Personal bookmarks");
    expect(dockTabs(useWorkspaceStore.getState().layout.root)[0]?.route).toBe("/apps/browser");
    expect(personal.textContent).not.toContain("Space-only cache");
    expect(useWorkspaceStore.getState().activeScopeKey).toBe("space:work");
  });

  it("opens Home as a global destination", async () => {
    await renderNavigator();

    await act(async () => {
      container.querySelector<HTMLAnchorElement>('a[aria-label="Home"]')?.click();
      await Promise.resolve();
    });

    expect(useWorkspaceStore.getState().activeScopeKey).toBe("space:space-1");
    expect(dockTabs(useWorkspaceStore.getState().layout.root)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          surfaceId: "home",
          groupKey: "tool:home",
          route: "/home",
          title: "Home",
        }),
      ]),
    );
  });

  it("opens Discover from the workspace header", async () => {
    await renderNavigator();

    await act(async () => {
      container.querySelector<HTMLAnchorElement>('a[aria-label="Discover"]')?.click();
      await Promise.resolve();
    });

    expect(dockTabs(useWorkspaceStore.getState().layout.root)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          surfaceId: "marketplace",
          groupKey: "tool:marketplace",
          route: "/discover",
          title: "Discover",
        }),
      ]),
    );
  });

  it("keeps Space tools visible while Spaces are loading", async () => {
    useSpacesStore.setState({
      spaces: [],
      invitations: [],
      limits: null,
      snapshotReady: false,
      loading: true,
      presenceBySpace: {},
    });
    useWorkspaceStore.setState({
      activeScopeKey: "global",
      layout: {
        focusedPaneId: "pane-1",
        root: {
          type: "leaf",
          id: "pane-1",
          activeTabId: null,
          tabs: [],
        },
      },
    });
    await renderNavigator("/spaces");

    const tools = container.querySelector('section[aria-label="Primary navigation"]');
    expect(tools?.querySelector('[role="status"]')?.textContent).toBe("Loading Space…");
    expect(container.querySelector('[aria-label="Space tools"]')).toBeNull();
    expect(tools?.querySelector('button[aria-label="Inbox"]')).not.toBeNull();
    expect(
      container.querySelector('[role="group"][aria-label="Apps"] button[aria-label="Browser"]'),
    ).not.toBeNull();
    expect(tools?.querySelector('button[aria-label="Terminal"]')).not.toBeNull();
  });

  it("moves a Space load failure to Activity without printing it in the navigator", async () => {
    const retry = vi.fn(async () => undefined);
    useSpacesStore.setState({
      spaces: [],
      invitations: [],
      snapshotReady: false,
      loading: false,
      error: "Offline",
      load: retry,
    });
    useWorkspaceStore.setState({ activeScopeKey: "global" });

    await renderNavigator("/spaces");

    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).not.toContain("Offline");
    expect(useActivityStore.getState().localItems[0]).toMatchObject({
      kind: "failure",
      title: "Spaces could not be loaded",
    });
    expect(retry).not.toHaveBeenCalled();
  });

  it("includes unread Space activity in the switcher’s accessible name", async () => {
    useActivityStore.setState({
      allItems: [
        {
          id: "spaces:9",
          accountId: "account-1",
          source: "spaces",
          sourceId: "9",
          kind: "mention",
          title: "Mention",
          body: "Please review",
          createdAt: "2026-08-08T12:00:00Z",
          attention: true,
          target: { kind: "space-chat", spaceId: "space-1" },
        },
      ],
    });

    await renderNavigator();

    expect(
      container.querySelector('button[aria-label="Switch Space, current Space: Family, 1 unread"]'),
    ).not.toBeNull();
  });

  it("shows the active Space in the header and lists Spaces in its menu", async () => {
    await renderNavigator();

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Switch Space, current Space: Family"]',
    );
    expect(trigger?.textContent).toContain("Family");
    expect(trigger?.hasAttribute("title")).toBe(false);
    expect(trigger?.textContent).not.toContain("Space");

    const menu = await openSpaceMenu();
    expect(trigger?.getAttribute("data-space-menu-open")).toBe("true");
    expect(
      trigger?.querySelector('[data-chevron-placement="inline"]')?.getAttribute("class"),
    ).toContain("rotate-90");
    const activeSpace = [...(menu?.querySelectorAll('[role="menuitem"]') ?? [])].find((item) =>
      item.textContent?.includes("Family"),
    );
    expect(activeSpace?.className).toContain("h-8");
    expect(activeSpace?.parentElement?.parentElement?.className).toContain("gap-1");
    expect(activeSpace?.getAttribute("aria-current")).toBe("page");
    expect(menu?.querySelector(".lucide-check")).toBeNull();
    expect(
      activeSpace?.querySelector('[aria-label="Family default profile picture"]'),
    ).not.toBeNull();
  });

  it("keeps creation in the Space menu and exposes actions in the Space island", async () => {
    await renderNavigator();

    const menu = await openSpaceMenu();
    expect(menu?.textContent).toContain("New Space");
    expect(menu?.textContent).not.toContain("Space settings");
    const island = container.querySelector('[data-navigator-space-island="true"]');
    expect(island?.querySelector('button[aria-label="Family usage"]')).not.toBeNull();
    expect(island?.querySelector('button[aria-label="Family members"]')).not.toBeNull();
    expect(island?.querySelector('a[aria-label="Family settings"]')).not.toBeNull();
    expect(menu?.querySelector('button[aria-label="Family usage"]')).toBeNull();
    expect(menu?.querySelector('button[aria-label="Family members"]')).toBeNull();
    expect(menu?.querySelector('a[aria-label="Family settings"]')).toBeNull();

    const spaceName = menu?.querySelector('[data-space-name="space-1"]');
    expect(spaceName?.className).toContain("overflow-hidden");
    expect(spaceName?.className).not.toContain("mask-image");
    expect(spaceName?.getAttribute("data-text-overflowing")).toBe("false");
    expect(spaceName?.getAttribute("title")).toBe("Family");
    expect(spaceName?.closest('[role="menuitem"]')?.className).not.toContain("pr-[94px]");
    expect(menu?.className).toContain("w-[240px]");
  });

  it("closes the space menu when clicking outside", async () => {
    await renderNavigator();

    const menu = await openSpaceMenu();
    expect(menu).not.toBeNull();

    await act(async () => {
      window.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
      await Promise.resolve();
    });

    expect(document.body.querySelector('[role="menu"]')).toBeNull();
  });

  it("closes the space menu when opening settings from the Space island", async () => {
    await renderNavigator();

    await openSpaceMenu();
    const settingsLink = container.querySelector<HTMLAnchorElement>(
      '[data-navigator-space-island="true"] a[aria-label="Family settings"]',
    );
    expect(settingsLink?.getAttribute("href")).toBe("/spaces/space-1/settings/general");
    expect(settingsLink).not.toBeNull();

    await act(async () => {
      settingsLink?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
      await Promise.resolve();
    });

    expect(document.body.querySelector('[role="menu"]')).toBeNull();
  });

  it("closes the space menu when selecting the active space", async () => {
    await renderNavigator();

    const menu = await openSpaceMenu();
    const activeItem = [...(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])].find(
      (item) => item.textContent?.includes("Family"),
    );
    expect(activeItem).not.toBeNull();

    await act(async () => {
      activeItem?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
      await Promise.resolve();
    });

    expect(document.body.querySelector('[role="menu"]')).toBeNull();
  });

  it("closes the space menu when pressing Escape", async () => {
    await renderNavigator();

    const menu = await openSpaceMenu();
    expect(menu).not.toBeNull();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await Promise.resolve();
    });

    expect(document.body.querySelector('[role="menu"]')).toBeNull();
  });

  it("limits active space name width and fades out overflowing text", async () => {
    const longSpace = {
      ...spaceFixture,
      id: "space-long",
      name: "Very Long Space Name That Exceeds The Maximum Allowed Header Width",
    };
    useSpacesStore.setState({
      spaces: [longSpace],
    });
    useWorkspaceStore.setState({
      activeScopeKey: "space:space-long",
    });

    await renderNavigator("/spaces/space-long/notes");

    const switcher = container.querySelector<HTMLButtonElement>(
      'button[aria-label^="Switch Space, current Space: Very Long Space Name"]',
    );
    expect(switcher).not.toBeNull();
    expect(switcher?.className.split(" ")).toContain("w-fit");

    const activeSpaceName = switcher?.querySelector('[data-active-space-name="true"]');
    expect(activeSpaceName?.className).toContain("max-w-[150px]");
    expect(activeSpaceName?.className).toContain("overflow-hidden");
    expect(activeSpaceName?.getAttribute("title")).toBe(
      "Very Long Space Name That Exceeds The Maximum Allowed Header Width",
    );

    const spaceRow = container.querySelector('[data-navigator-space-row="true"]');
    expect(spaceRow?.querySelector('button[aria-label="Search"]')).toBeNull();
  });

  it("removes the permanent Spaces section from the navigator", async () => {
    await renderNavigator();

    expect(container.querySelector('section[aria-label="Spaces"]')).toBeNull();
    expect(container.textContent).not.toContain("New Space");
  });

  it("scrolls navigation between the fixed Misty and profile islands and bounds long Space menus", async () => {
    await renderNavigator();

    const tools = container.querySelector('[data-navigator-section-scroll="primary navigation"]');
    expect(tools?.className).toContain("overflow-y-auto");
    expect(tools?.className).toContain("misty-transient-scrollbar");
    expect(tools?.className).not.toContain("pr-1");
    expect(tools?.parentElement?.className).not.toContain("px-3");
    expect(tools?.firstElementChild?.className).toContain("px-3");
    expect(tools?.contains(container.querySelector('[data-navigator-header="true"]'))).toBe(false);
    expect(tools?.contains(container.querySelector('[data-navigator-server-row="true"]'))).toBe(
      false,
    );
    expect(tools?.contains(container.querySelector('[data-navigator-actions-row="true"]'))).toBe(
      true,
    );
    expect(tools?.contains(container.querySelector('[data-navigator-space-row="true"]'))).toBe(
      true,
    );
    expect(tools?.contains(container.querySelector('[data-tour-target="apps-section"]'))).toBe(
      true,
    );
    expect(tools?.contains(container.querySelector('[data-navigator-profile-bar="fixed"]'))).toBe(
      false,
    );
    expect(container.querySelector('[aria-label="Apps controls"]')?.className).not.toContain(
      "sticky",
    );

    const menu = await openSpaceMenu();
    expect(menu?.querySelector(".max-h-\\[320px\\]")).not.toBeNull();
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

    const tools = container.querySelector('section[aria-label="Primary navigation"]');
    expect(
      container.querySelector('button[aria-label="Switch Space, current Space: Family"]'),
    ).not.toBeNull();
    expect(
      container
        .querySelector('[role="group"][aria-label="Apps"] button[aria-label="Browser"]')
        ?.getAttribute("aria-current"),
    ).toBe("page");
    expect(tools?.querySelector('button[aria-label="Journal"]')).not.toBeNull();
  });

  it("derives aria-current from the focused workspace tab instead of the URL", async () => {
    await renderNavigator("/browser");

    expect(
      container
        .querySelector('[aria-label="Journal destinations"] a[aria-current="page"]')
        ?.textContent?.trim(),
    ).toBe("Notes");
    expect(
      container.querySelector('button[aria-label="Browser"]')?.hasAttribute("aria-current"),
    ).toBe(false);
    expect(container.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  });

  it("switches workspace scope when clicking on a different space", async () => {
    const space2Fixture = {
      ...spaceFixture,
      id: "space-2",
      name: "Work",
    };
    useSpacesStore.setState({
      spaces: [spaceFixture, space2Fixture],
    });

    await renderNavigator("/spaces/space-1/notes");

    const menu = await openSpaceMenu();
    const workItem = [...(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])].find(
      (item) => item.textContent?.includes("Work"),
    );
    expect(workItem).not.toBeNull();

    await act(async () => {
      workItem?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    });

    expect(useWorkspaceStore.getState().activeScopeKey).toBe("space:space-2");
  });

  it("opens a browser tab when clicking Browser in the nav bar even if no browser tab exists", async () => {
    // Start with only space tab, no browser tab
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

    await renderNavigator("/spaces/space-1/notes");

    const browserLink = container.querySelector<HTMLButtonElement>(
      '[role="group"][aria-label="Apps"] button[aria-label="Browser"]',
    );
    expect(browserLink).not.toBeNull();

    await act(async () => {
      browserLink?.click();
    });
    const currentTabs = dockTabs(useWorkspaceStore.getState().layout.root);
    expect(currentTabs.some((tab) => tab.groupKey === "app:browser")).toBe(true);
    expect(useWorkspaceStore.getState().activeScopeKey).toBe("space:space-1");
  });

  it("aligns every navigation row to the same icon and horizontal spacing", async () => {
    await renderNavigator();

    const toolLinks = [
      ...container.querySelectorAll(
        '[data-tour-target="apps-section"] a[aria-label], [data-tour-target="apps-section"] button[data-navigator-disclosure-trigger="true"], [data-tour-target="apps-section"] [aria-disabled="true"]',
      ),
    ].filter((row) =>
      NAVIGATOR_APP_IDS.some((id) => id === row.getAttribute("aria-label")?.toLowerCase()),
    );

    expect(toolLinks.length).toBeGreaterThan(0);

    for (const row of toolLinks) {
      const iconContainer = row.querySelector('span[class*="size-[18px]"]');
      expect(iconContainer?.tagName.toLowerCase()).toBe("span");
      expect(iconContainer?.className).toContain("size-[18px]");
      expect(iconContainer?.className).toContain("justify-center");
      expect(iconContainer?.querySelector("svg")?.getAttribute("width")).toBe("20");
      expect(iconContainer?.querySelector("svg")?.classList.contains("!size-5")).toBe(true);
      const appIcon = iconContainer?.querySelector<HTMLElement>("[data-app-icon]");
      expect(appIcon?.className.split(/\s+/)).toContain("text-cream-bright");
      expect(appIcon?.className).not.toMatch(/text-(?:avatar|agent)-/);
    }

    const quickRows = ["Code", "Terminal"].map((label) =>
      container.querySelector(`[aria-label="${label}"]`),
    );
    expect(quickRows.every((row) => row?.className.includes("px-2.5"))).toBe(true);
    expect(container.querySelector('a[aria-label="Home"]')?.className).toContain("w-full");
    expect(container.querySelector('a[aria-label="Home"]')?.className).toContain("px-2.5");

    const switcher = container.querySelector(
      'button[aria-label="Switch Space, current Space: Family"]',
    );
    expect(switcher?.className.split(" ")).toContain("w-fit");
    expect(switcher?.firstElementChild?.className).toContain("size-6");
    expect(
      switcher?.lastElementChild?.lastElementChild?.getAttribute("data-chevron-placement"),
    ).toBe("inline");
    expect(switcher?.lastElementChild?.lastElementChild?.getAttribute("class")).toContain(
      "duration-150",
    );
    expect(switcher?.lastElementChild?.className).toContain("gap-1");
  });

  it("renders instance-owned SDK navigation, opens its workspace route and removes it on close", async () => {
    const scope = createAppRpcScope({
      identity: {
        appId: "terminal",
        accountId: "account-1",
        spaceId: "",
        instanceId: "tab-1",
      },
      scopes: ["navigation.write"],
      expiresAt: "2099-01-01T00:00:00Z",
      isCurrentAccount: () => true,
    });
    const navigation = createAppNavigationRegistration(scope);
    const otherScope = createAppRpcScope({
      identity: {
        appId: "terminal",
        accountId: "another-account",
        spaceId: "",
        instanceId: "other-tab",
      },
      scopes: ["navigation.write"],
      expiresAt: "2099-01-01T00:00:00Z",
      isCurrentAccount: () => true,
    });
    createAppNavigationRegistration(otherScope).setItems([
      { id: "private", label: "Other account private item", route: "/apps/terminal?space=space-1" },
    ]);
    try {
      await executeAppCapability(
        {
          app: { id: "terminal", slug: "terminal", scopes: ["navigation.write"] } as OfficialApp,
          session: {
            app_id: "terminal",
            space_id: "",
            scopes: ["navigation.write"],
            expires_at: "2099-01-01T00:00:00Z",
            token: "fixture",
            sdk_base_url: "/app-runtime",
          },
          serverBase: "https://misty.example/v1",
          user: { id: "account-1", name: "Fixture", email: "fixture@example.com" },
          platform: "desktop",
          setNavigationItems: navigation.setItems,
        },
        "navigation.setItems",
        {
          items: [
            {
              id: "downloaded",
              label: "Downloaded app view",
              route: "/apps/terminal?view=drawings",
            },
          ],
        },
      );
      await renderNavigator();
      await act(async () =>
        container.querySelector<HTMLButtonElement>('button[aria-label="Terminal"]')?.click(),
      );
      expect(container.textContent).not.toContain("Other account private item");
      const link = [...container.querySelectorAll("a")].find((item) =>
        item.textContent?.includes("Downloaded app view"),
      );
      expect(link?.getAttribute("href")).toBe("/apps/terminal?view=drawings");
      await act(async () =>
        link?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 })),
      );
      expect(
        dockTabs(useWorkspaceStore.getState().layout.root).some(
          (tab) => tab.route === "/apps/terminal?view=drawings",
        ),
      ).toBe(true);
      await act(async () => scope.close());
      expect(container.textContent).not.toContain("Downloaded app view");
      expect(container.querySelector('button[aria-label="Terminal"]')).not.toBeNull();
    } finally {
      scope.close();
      otherScope.close();
    }
  });

  it("offers built-in Space tools even when no apps are installed", async () => {
    useAppsStore.setState({ installations: [] });
    await renderNavigator();
    const space = container.querySelector('section[aria-label="Space"]')!;
    for (const label of ["Chat", "Journal", "Planner", "Library"]) {
      expect(space.querySelector(`[aria-label="${label}"]`)).not.toBeNull();
    }
    await act(async () =>
      space.querySelector<HTMLButtonElement>('[aria-label="Planner"]')!.click(),
    );
    await act(async () =>
      space.querySelector<HTMLAnchorElement>('[aria-label="Planner destinations"] a')!.click(),
    );
    expect(dockTabs(useWorkspaceStore.getState().layout.root)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          surfaceId: "space",
          groupKey: "space:space-1:planner",
          route: "/spaces/space-1/planner/tasks/board",
        }),
      ]),
    );
  });

  it("expands Chat, keeps Apps visible, and keeps section order inside its own hierarchy", async () => {
    const previous = useSettingsStore.getState();
    const save = vi.fn((section: string, key: string, value: unknown) => {
      const document = useSettingsStore.getState().settings?.document ?? {};
      useSettingsStore.setState({
        settings: {
          document: { ...document, [section]: { ...(document[section] as object), [key]: value } },
        } as never,
      });
    });
    useSettingsStore.setState({ loaded: true, settings: null, updateSetting: save });
    try {
      await renderNavigator();
      const space = container.querySelector('[aria-label="Space tools"]')!;
      const global = container.querySelector('[aria-label="Global navigation"]')!;
      const apps = container.querySelector('[data-reorder-list="navigator:account-1:sections"]')!;
      const chat = space.querySelector<HTMLButtonElement>('[aria-label="Chat"]')!;
      expect(chat.getAttribute("aria-expanded")).toBe("false");
      await act(async () => chat.click());
      await act(async () => chat.click());
      expect(chat.getAttribute("aria-expanded")).toBe("false");
      await act(async () => chat.click());
      expect(chat.getAttribute("aria-expanded")).toBe("true");
      expect(space.querySelector('[aria-label="Chat destinations"]')?.textContent).toContain(
        "Messages",
      );
      const moveDown = async (element: Element) =>
        act(async () => {
          element.dispatchEvent(
            new KeyboardEvent("keydown", {
              bubbles: true,
              key: "ArrowDown",
              altKey: true,
              shiftKey: true,
            }),
          );
        });
      await moveDown(chat);
      expect([...space.children].map((item) => item.getAttribute("data-reorder-item"))).toEqual([
        "journal",
        "social",
        "planner",
        "library",
      ]);
      const journalHeader = space.querySelector<HTMLButtonElement>('[aria-label="Journal"]')!;
      if (journalHeader.getAttribute("aria-expanded") !== "true")
        await act(async () => journalHeader.click());
      const journal = space.querySelector('[aria-label="Journal destinations"]')!;
      await moveDown(journal.querySelector("a")!);
      expect([...journal.children].map((item) => item.textContent)).toEqual(["Drawings", "Notes"]);
      expect([...space.children].map((item) => item.getAttribute("data-reorder-item"))).toEqual([
        "journal",
        "social",
        "planner",
        "library",
      ]);
      await moveDown(global.querySelector('[aria-label="Home"]')!);
      expect([...global.children].map((item) => item.getAttribute("data-reorder-item"))).toEqual([
        "discover",
        "home",
        "agents",
      ]);
      expect(apps.firstElementChild?.getAttribute("data-reorder-item")).toBe("inbox");
      expect(space.getAttribute("data-reorder-list")).not.toBe(
        apps.getAttribute("data-reorder-list"),
      );
      expect(
        space.closest('section[aria-label="Space"]')?.closest("[data-reorder-item]"),
      ).toBeNull();
      const appsHeading = container.querySelector("h2")!;
      expect(appsHeading.closest("[data-reorder-item]")).toBeNull();
      expect(appsHeading.querySelector("button")).toBeNull();
      expect(appsHeading.querySelector("[data-chevron-placement]")).toBeNull();
      expect(
        container.querySelector('[data-reorder-list="navigator:account-1:sections"]'),
      ).not.toBeNull();
      expect(save).toHaveBeenCalledWith(
        "navigation",
        "orders_by_account",
        expect.objectContaining({
          "account-1": expect.objectContaining({
            "space:space-1:sections": ["journal", "social", "planner", "library"],
          }),
        }),
      );
    } finally {
      await act(async () => useSettingsStore.setState(previous));
    }
  });

  it("keeps denied Space tools out of the collaborative section", async () => {
    useSpacesStore.setState({
      spaces: [
        {
          ...spaceFixture,
          permissions: { "messages.read": false, "tasks.view": false, "library.view": false },
        },
      ],
    });
    await renderNavigator();
    const space = container.querySelector('section[aria-label="Space"]')!;
    expect(space.querySelector('[aria-label="Journal"]')).not.toBeNull();
    for (const label of ["Chat", "Planner", "Library"])
      expect(space.querySelector(`[aria-label="${label}"]`)).toBeNull();
  });

  async function openSpaceMenu() {
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Switch Space, current Space: Family"]',
        )
        ?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
      await Promise.resolve();
    });
    return document.body.querySelector<HTMLElement>('[role="menu"]');
  }

  async function renderNavigator(initialEntry = "/spaces/space-1/notes") {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[initialEntry]}>
          <GlobalNavigator
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
