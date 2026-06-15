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
    useAppNavigationStore.setState({ entries: [] });
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

    const tools = container.querySelector('section[aria-label="Primary navigation"]');
    expect(
      [...tools!.querySelectorAll("a, button, [aria-disabled='true']")]
        .map((link) => link.getAttribute("aria-label"))
        .filter((label) => NAVIGATOR_APP_IDS.some((id) => id === label?.toLowerCase())),
    ).toEqual([
      "Inbox",
      "Social",
      "Journal",
      "Files",
      "Agents",
      "Planner",
      "Library",
      "Browser",
      "Code",
      "Terminal",
    ]);
    expect(container.querySelector('a[aria-label="Extensions"]')).toBeNull();
    expect(container.querySelector('a[aria-label="Transfers"]')).toBeNull();
    expect(tools?.querySelector('[role="group"][aria-label="Apps"]')).not.toBeNull();
    expect(
      tools?.querySelector('button[aria-label="Collapse Apps"] [data-chevron-placement="inline"]'),
    ).not.toBeNull();
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
    expect(disclosureToggles).toHaveLength(7);
    expect(
      disclosureToggles.every((toggle) =>
        toggle.querySelector('[data-chevron-placement="inline"]'),
      ),
    ).toBe(true);
    expect(tools?.querySelector('[data-app-icon="home"]')).toBeNull();
    expect(tools?.querySelector('[data-app-icon="journal"]')).not.toBeNull();
    expect(tools?.querySelector('[data-app-icon="files"]')).not.toBeNull();
    expect(tools?.querySelector('[data-app-icon="planner"]')).not.toBeNull();
    expect(tools?.querySelector('button[aria-label="Collapse Apps"]')?.textContent).toContain(
      "Apps",
    );
    const profileBar = container.querySelector('[data-navigator-profile-bar="floating"]');
    expect(profileBar?.className).toContain("inset-x-2");
    expect(profileBar?.className).toContain("bottom-2");
    expect(profileBar?.firstElementChild?.className).toContain("rounded-xl");
    expect(profileBar?.firstElementChild?.className).toContain("bg-charcoal-card");
    expect(
      tools
        ?.querySelector('[aria-label="Journal destinations"] a[aria-current="page"]')
        ?.textContent?.trim(),
    ).toBe("Notes");
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

    const actions = container.querySelector('[aria-label="Workspace actions"]');
    expect(
      [...actions!.querySelectorAll("a, button")].map((item) => item.getAttribute("aria-label")),
    ).toEqual(["Home", "Discover"]);
    expect(actions?.querySelector('a[aria-label="Home"]')?.getAttribute("href")).toBe(
      "/spaces/space-1/home",
    );
    expect(actions?.querySelector('a[aria-label="Discover"]')?.getAttribute("href")).toBe(
      "/discover",
    );

    const searchButton = container.querySelector<HTMLButtonElement>(
      '[data-navigator-space-row="true"] button[aria-label="Search"]',
    );
    expect(searchButton).not.toBeNull();

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
          '[data-navigator-space-row="true"] button[aria-label="Search"]',
        )
        ?.click();
      await vi.waitFor(() =>
        expect(desktopPetMocks.toggleDesktopMistyPanel).toHaveBeenCalledOnce(),
      );
    });

    expect(useGlobalSearchStore.getState().panel).toBe("closed");
  });

  it("uses the active Space selector as the top-left header control", async () => {
    await renderNavigator();

    expect(container.querySelector('[data-misty-brand="true"]')).toBeNull();
    const switcher = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Switch Space, current Space: Family"]',
    );
    expect(switcher?.textContent).toContain("Family");
    expect(switcher?.querySelector('[aria-label="Family default profile picture"]')).not.toBeNull();
    expect(switcher?.querySelector('img[alt=""]')).toBeNull();
    expect(switcher?.className).toContain("h-9");
    expect(switcher?.className).toContain("flex-1");
    expect(switcher?.className).toContain("max-w-[calc(100%_-_2.5rem)]");
    const activeSpaceName = switcher?.querySelector('[data-active-space-name="true"]');
    expect(activeSpaceName?.className).toContain("overflow-hidden");
    expect(activeSpaceName?.className).toContain("max-w-[150px]");
    expect(activeSpaceName?.className).not.toContain("mask-image");
    expect(activeSpaceName?.getAttribute("data-text-overflowing")).toBe("false");
    expect(activeSpaceName?.className).not.toContain("truncate");
    expect(activeSpaceName?.getAttribute("title")).toBe("Family");
    expect(
      switcher?.querySelector('[aria-label="Family default profile picture"]')?.className,
    ).toContain("size-7");

    const header = switcher?.closest('[data-navigator-header="true"]');
    expect(header).not.toBeNull();
    expect(header?.className).toContain("grid");
    const spaceRow = header?.querySelector('[data-navigator-space-row="true"]');
    expect(spaceRow?.className).toContain("w-full");
    expect(spaceRow?.className).toContain("min-w-0");
    const actions = header?.querySelector('[aria-label="Workspace actions"]');
    expect(actions?.className).toContain("grid");
    expect(actions?.className).toContain("gap-1");
    expect(actions?.className).toContain("w-full");
    const searchButton = spaceRow?.querySelector('button[aria-label="Search"]');
    const homeButton = actions?.querySelector('a[aria-label="Home"]');
    const marketplaceButton = actions?.querySelector('a[aria-label="Discover"]');
    expect(searchButton?.className).toContain("size-9");
    expect(searchButton?.querySelector("svg")?.getAttribute("width")).toBe("18");
    expect(searchButton?.textContent).toBe("");
    expect(homeButton?.className).toContain("text-cream-bright");
    expect(homeButton?.className).not.toContain("text-avatar-yellow");
    expect(homeButton?.className).toContain("h-9");
    expect(homeButton?.className).toContain("w-full");
    expect(homeButton?.querySelector("svg")?.getAttribute("width")).toBe("18");
    expect(homeButton?.textContent).toBe("Home");
    expect(marketplaceButton?.className).toContain("h-9");
    expect(marketplaceButton?.className).toContain("w-full");
    expect(marketplaceButton?.className).toContain("text-cream-bright");
    expect(marketplaceButton?.querySelector("svg")?.getAttribute("width")).toBe("18");
    expect(marketplaceButton?.textContent).toBe("Discover");
    expect(container.querySelector('[data-navigator-space-switcher="true"]')).toBeNull();

    expect(container.querySelector('button[aria-label="Collapse Apps"]')?.textContent).toContain(
      "Apps",
    );
  });

  it("opens Home in the current Space instead of a global app tab", async () => {
    await renderNavigator();

    await act(async () => {
      container.querySelector<HTMLAnchorElement>('a[aria-label="Home"]')?.click();
      await Promise.resolve();
    });

    expect(useWorkspaceStore.getState().activeScopeKey).toBe("space:space-1");
    expect(dockTabs(useWorkspaceStore.getState().layout.root)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          surfaceId: "space",
          route: "/spaces/space-1/home",
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
    expect(tools?.querySelector('[role="status"]')?.textContent).toBe("Loading Space apps…");
    expect(tools?.querySelector('[aria-label="Journal"]')?.getAttribute("aria-disabled")).toBe(
      "true",
    );
    expect(tools?.querySelector('[aria-label="Journal"]')?.getAttribute("aria-describedby")).toBe(
      "navigator-space-status",
    );
    expect(tools?.querySelector('button[aria-label="Inbox"]')).not.toBeNull();
    expect(tools?.querySelector('a[aria-label="Browser"]')).not.toBeNull();
    expect(tools?.querySelector('a[aria-label="Terminal"]')).not.toBeNull();
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
    ).toContain("rotate-180");
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

  it("keeps creation and hover-revealed row actions in the Space menu", async () => {
    await renderNavigator();

    const menu = await openSpaceMenu();
    expect(menu?.textContent).toContain("New Space");
    expect(menu?.textContent).not.toContain("Space settings");
    expect(menu?.querySelector('button[aria-label="Family usage"]')).not.toBeNull();
    expect(menu?.querySelector('button[aria-label="Family team"]')).not.toBeNull();
    expect(menu?.querySelector('a[aria-label="Family settings"]')).not.toBeNull();

    const actions = menu?.querySelector('[data-space-row-actions="space-1"]');
    expect(actions?.className).toContain("opacity-0");
    expect(actions?.className).toContain("group-hover/space-menu-row:opacity-100");
    expect(actions?.className).toContain("w-[86px]");
    const spaceName = menu?.querySelector('[data-space-name="space-1"]');
    expect(spaceName?.className).toContain("overflow-hidden");
    expect(spaceName?.className).not.toContain("mask-image");
    expect(spaceName?.getAttribute("data-text-overflowing")).toBe("false");
    expect(spaceName?.getAttribute("title")).toBe("Family");
    expect(spaceName?.closest('[role="menuitem"]')?.className).toContain("pr-[94px]");
    expect(menu?.className).toContain("w-[240px]");
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
    expect(switcher?.className).toContain("flex-1");
    expect(switcher?.className).toContain("max-w-[calc(100%_-_2.5rem)]");

    const activeSpaceName = switcher?.querySelector('[data-active-space-name="true"]');
    expect(activeSpaceName?.className).toContain("max-w-[150px]");
    expect(activeSpaceName?.className).toContain("overflow-hidden");
    expect(activeSpaceName?.getAttribute("title")).toBe(
      "Very Long Space Name That Exceeds The Maximum Allowed Header Width",
    );

    const spaceRow = container.querySelector('[data-navigator-space-row="true"]');
    expect(spaceRow?.querySelector('button[aria-label="Search"]')).not.toBeNull();
  });

  it("removes the permanent Spaces section from the navigator", async () => {
    await renderNavigator();

    expect(container.querySelector('section[aria-label="Spaces"]')).toBeNull();
    expect(container.textContent).not.toContain("New Space");
  });

  it("keeps tool scrolling in the rail and bounds long Space menus", async () => {
    await renderNavigator();

    const tools = container.querySelector('[data-navigator-section-scroll="primary navigation"]');
    expect(tools?.className).toContain("overflow-y-auto");
    expect(tools?.className).toContain("misty-transient-scrollbar");
    expect(tools?.className).not.toContain("pr-1");
    expect(tools?.parentElement?.className).not.toContain("px-3");
    expect(tools?.firstElementChild?.className).toContain("px-3");

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
    expect(tools?.querySelector('a[aria-label="Browser"]')?.getAttribute("aria-current")).toBe(
      "page",
    );
    expect(tools?.querySelector('button[aria-label="Journal"]')).not.toBeNull();
  });

  it("derives aria-current from the focused workspace tab instead of the URL", async () => {
    await renderNavigator("/browser");

    expect(
      container
        .querySelector('[aria-label="Journal destinations"] a[aria-current="page"]')
        ?.textContent?.trim(),
    ).toBe("Notes");
    expect(container.querySelector('a[aria-label="Browser"]')?.hasAttribute("aria-current")).toBe(
      false,
    );
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

    const tools = container.querySelector('section[aria-label="Primary navigation"]');
    const browserLink = tools?.querySelector<HTMLAnchorElement>('a[aria-label="Browser"]');
    expect(browserLink).not.toBeNull();

    await act(async () => {
      browserLink?.click();
    });

    const currentTabs = dockTabs(useWorkspaceStore.getState().layout.root);
    expect(currentTabs.some((tab) => tab.groupKey === "app:browser")).toBe(true);
  });

  it("aligns every navigation row to the same icon and horizontal spacing", async () => {
    await renderNavigator();

    const toolLinks = [
      ...container.querySelectorAll(
        'section[aria-label="Primary navigation"] a[aria-label], section[aria-label="Primary navigation"] button[data-navigator-disclosure-trigger="true"], section[aria-label="Primary navigation"] [aria-disabled="true"]',
      ),
    ].filter((row) =>
      NAVIGATOR_APP_IDS.some((id) => id === row.getAttribute("aria-label")?.toLowerCase()),
    );

    expect(toolLinks.length).toBeGreaterThan(0);

    for (const row of toolLinks) {
      const iconContainer = row.firstElementChild;
      expect(iconContainer?.tagName.toLowerCase()).toBe("span");
      expect(iconContainer?.className).toContain("size-[18px]");
      expect(iconContainer?.className).toContain("justify-center");
      expect(iconContainer?.querySelector("svg")?.getAttribute("width")).toBe("20");
      expect(iconContainer?.querySelector("svg")?.classList.contains("!size-5")).toBe(true);
      const appIcon = iconContainer?.querySelector<HTMLElement>("[data-app-icon]");
      expect(appIcon?.className.split(/\s+/)).toContain("text-cream-bright");
      expect(appIcon?.className).not.toMatch(/text-(?:avatar|agent)-/);
    }

    const quickRows = ["Agents"].map((label) => container.querySelector(`[aria-label="${label}"]`));
    expect(quickRows.every((row) => row?.className.includes("px-2.5"))).toBe(true);
    expect(container.querySelector('a[aria-label="Home"]')?.className).toContain("w-full");
    expect(container.querySelector('a[aria-label="Home"]')?.className).toContain("px-2.5");

    const switcher = container.querySelector(
      'button[aria-label="Switch Space, current Space: Family"]',
    );
    expect(switcher?.className.split(" ")).toContain("flex-1");
    expect(switcher?.className.split(" ")).toContain("max-w-[calc(100%_-_2.5rem)]");
    expect(switcher?.firstElementChild?.className).toContain("size-[18px]");
    expect(switcher?.firstElementChild?.querySelector("[class*='size-7']")).not.toBeNull();
    expect(switcher?.lastElementChild?.className).toContain("gap-1");
    expect(switcher?.lastElementChild?.className).not.toContain("flex-1");
    expect(switcher?.lastElementChild?.firstElementChild?.className).not.toContain("flex-1");
    expect(switcher?.lastElementChild?.lastElementChild?.classList).not.toContain("ml-auto");
    expect(
      switcher?.lastElementChild?.lastElementChild?.getAttribute("data-chevron-placement"),
    ).toBe("inline");
    expect(switcher?.lastElementChild?.lastElementChild?.getAttribute("class")).toContain(
      "duration-150",
    );
  });

  it("renders instance-owned SDK navigation, opens its workspace route and removes it on close", async () => {
    const scope = createAppRpcScope({
      identity: {
        appId: "journal",
        accountId: "account-1",
        spaceId: "space-1",
        instanceId: "tab-1",
      },
      scopes: ["navigation.write"],
      expiresAt: "2099-01-01T00:00:00Z",
      isCurrentAccount: () => true,
    });
    const navigation = createAppNavigationRegistration(scope);
    const otherScope = createAppRpcScope({
      identity: {
        appId: "journal",
        accountId: "another-account",
        spaceId: "space-1",
        instanceId: "other-tab",
      },
      scopes: ["navigation.write"],
      expiresAt: "2099-01-01T00:00:00Z",
      isCurrentAccount: () => true,
    });
    createAppNavigationRegistration(otherScope).setItems([
      { id: "private", label: "Other account private item", route: "/apps/journal?space=space-1" },
    ]);
    try {
      await executeAppCapability(
        {
          app: { id: "journal", slug: "journal", scopes: ["navigation.write"] } as OfficialApp,
          session: {
            app_id: "journal",
            space_id: "space-1",
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
              route: "/apps/journal?view=drawings",
            },
          ],
        },
      );
      await renderNavigator();
      expect(container.textContent).not.toContain("Other account private item");
      const link = [...container.querySelectorAll("a")].find((item) =>
        item.textContent?.includes("Downloaded app view"),
      );
      expect(link?.getAttribute("href")).toBe("/apps/journal?view=drawings&space=space-1");
      await act(async () =>
        link?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 })),
      );
      expect(
        dockTabs(useWorkspaceStore.getState().layout.root).some(
          (tab) => tab.route === "/apps/journal?view=drawings&space=space-1",
        ),
      ).toBe(true);
      await act(async () => scope.close());
      expect(container.textContent).not.toContain("Downloaded app view");
      expect(container.querySelector('[data-navigator-disclosure="journal"]')).not.toBeNull();
    } finally {
      scope.close();
      otherScope.close();
    }
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
