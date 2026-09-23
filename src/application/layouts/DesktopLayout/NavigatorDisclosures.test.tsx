import {
  createAppNavigationRegistration,
  useAppNavigationStore,
} from "@/features/apps/appNavigation";
import { createAppRpcScope } from "@/features/apps/rpc/session";
import { useActivityStore } from "@/features/activity";
import { useAiSurfaceStore } from "@/features/ai-surface";
import { resetInboxAccountState, useInboxStore } from "@/features/inbox";
import { useSpacesStore } from "@/features/spaces";
import { dockTabs, useNavigatorAppsStore, useWorkspaceStore } from "@/features/workspace";
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GlobalNavigator } from "./GlobalNavigator";
import { seedNavigatorApps, spaceFixture, spaceTab } from "./GlobalNavigator.testFixtures";

vi.mock("@/features/auth", () => ({
  useAuth: () => ({ user: { id: "account-1", email: "owner@example.com" } }),
  useAccountAvatarUrl: () => null,
  useUserStore: (selector: (state: { me: null }) => unknown) => selector({ me: null }),
}));

describe("GlobalNavigator disclosures", () => {
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
    useAiSurfaceStore.setState({
      sessions: {},
      registrations: {},
      companion: { phase: "home", completedCount: 0 },
    });
    useSpacesStore.setState({
      spaces: [spaceFixture],
      invitations: [],
      limits: null,
      snapshotReady: true,
      loading: false,
      error: null,
      presenceBySpace: {},
    });
    useWorkspaceStore.getState().reset();
    seedNavigatorApps();
    useAppNavigationStore.setState({ entries: [], providerCache: [] });
    resetInboxAccountState();
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
    useActivityStore.setState({ allItems: [] });
    useSpacesStore.setState({ spaces: [], invitations: [], presenceBySpace: {} });
    useAiSurfaceStore.setState({
      sessions: {},
      registrations: {},
      companion: { phase: "home", completedCount: 0 },
    });
    useWorkspaceStore.getState().reset();
    resetInboxAccountState();
  });

  it("shows provider types, not individual accounts, under Inbox", async () => {
    useInboxStore.setState({
      accountId: "account-1",
      loaded: true,
      selectedProvider: "microsoft",
      accounts: [
        {
          connection_id: "gmail-1",
          provider: "google",
          account_id: "google-account",
          display_name: "Personal Gmail",
          email: "personal@example.com",
          total: 4,
          unread: 1,
        },
        {
          connection_id: "outlook-1",
          provider: "microsoft",
          account_id: "microsoft-account",
          display_name: "Work Outlook",
          email: "work@example.com",
          total: 8,
          unread: 2,
        },
      ],
    });
    useWorkspaceStore.setState({
      layout: {
        focusedPaneId: "pane-1",
        root: {
          type: "leaf",
          id: "pane-1",
          activeTabId: "inbox-tab",
          tabs: [
            {
              id: "inbox-tab",
              surfaceId: "official-app",
              groupKey: "app:inbox",
              instanceKey: "inbox",
              title: "Inbox",
              route: "/apps/inbox?provider=microsoft",
              sidebarVisible: true,
              state: {},
              createdAt: 1,
              lastFocusedAt: 1,
            },
          ],
        },
      },
    });

    await renderNavigator("/apps/inbox?provider=microsoft");

    const inboxItems = [
      ...container.querySelectorAll<HTMLAnchorElement>(
        '[role="group"][aria-label="Inbox destinations"] a',
      ),
    ];
    expect(inboxItems.map((item) => item.textContent?.trim())).toEqual(["Gmail", "Outlook"]);
    expect(container.textContent).not.toContain("personal@example.com");
    expect(container.textContent).not.toContain("work@example.com");
    expect(
      inboxItems
        .find((item) => item.textContent?.trim() === "Outlook")
        ?.getAttribute("aria-current"),
    ).toBe("page");
    expect(
      inboxItems.map((item) =>
        item.querySelector("[data-mail-provider-icon]")?.getAttribute("data-mail-provider-icon"),
      ),
    ).toEqual(["gmail", "outlook"]);

    await act(async () => useInboxStore.setState({ selectedProvider: "" }));

    expect(useInboxStore.getState().selectedProvider).toBe("");
  });

  it("keeps native Agents navigation independent of legacy SDK registration", async () => {
    const scope = createAppRpcScope({
      identity: {
        appId: "agents",
        accountId: "account-1",
        spaceId: "space-1",
        instanceId: "agents-tab",
      },
      scopes: ["navigation.write"],
      expiresAt: "2099-01-01T00:00:00Z",
      isCurrentAccount: () => true,
    });
    createAppNavigationRegistration(scope).setItems([
      { id: "activity", label: "Current agent activity", route: "/apps/agents" },
    ]);
    await renderNavigator("/discover");
    expect(container.querySelector('a[aria-label="Agents"]')?.getAttribute("href")).toBe(
      "/apps/agents",
    );
    expect(container.textContent).not.toContain("Current agent activity");
    await act(async () => scope.close());
    expect(container.querySelector('a[aria-label="Agents"]')?.getAttribute("href")).toBe(
      "/apps/agents",
    );
    useAppNavigationStore.setState({ entries: [], providerCache: [] });
  });

  it("shows the current Agents Activity destination without a mounted app", async () => {
    useWorkspaceStore.setState({
      layout: {
        focusedPaneId: "pane-1",
        root: {
          type: "leaf",
          id: "pane-1",
          activeTabId: "agents-tab",
          tabs: [
            {
              id: "agents-tab",
              surfaceId: "official-app",
              groupKey: "app:agents",
              instanceKey: "agents",
              title: "Agents",
              route: "/apps/agents?view=automations",
              sidebarVisible: true,
              state: {},
              createdAt: 1,
              lastFocusedAt: 1,
            },
          ],
        },
      },
    });

    await renderNavigator("/apps/agents?view=automations");

    const link = container.querySelector('a[aria-label="Agents"]');
    expect(link?.getAttribute("href")).toBe("/apps/agents");
    expect(link?.getAttribute("aria-current")).toBe("page");
    expect(container.querySelector('[aria-label="Agents destinations"]')).toBeNull();
  });

  it("opens Planner destinations and highlights only the active section", async () => {
    useWorkspaceStore.setState({
      layout: {
        focusedPaneId: "pane-1",
        root: {
          type: "leaf",
          id: "pane-1",
          activeTabId: "tab-1",
          tabs: [
            {
              ...spaceTab,
              groupKey: "app:planner",
              instanceKey: "planner",
              title: "Planner",
              route: "/apps/planner?space=space-1&view=agenda&date=2026-08-26",
            },
          ],
        },
      },
    });
    await renderNavigator("/apps/planner?space=space-1&view=agenda&date=2026-08-26");

    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-space-tool="planner"] button[aria-label="Planner"]',
    );
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    expect(trigger?.className).toContain("w-full");
    expect(
      trigger?.querySelector('[data-chevron-placement]')?.getAttribute("data-chevron-placement"),
    ).toBe("inline");

    const destinations = container.querySelector(
      '[role="group"][aria-label="Planner destinations"]',
    );
    const items = [...(destinations?.querySelectorAll<HTMLAnchorElement>("a") ?? [])];
    expect(items.map((item) => item.textContent?.trim())).toEqual(["Tasks", "Agenda", "Roadmaps"]);
    expect(featureIconNames(destinations)).toEqual(["tasks", "agenda", "roadmaps"]);
    expect(destinations?.textContent).not.toContain("Last used");
    expect(
      items.find((item) => item.textContent?.includes("Agenda"))?.getAttribute("aria-current"),
    ).toBe("page");
    expect(
      items.find((item) => item.textContent?.includes("Tasks"))?.hasAttribute("aria-current"),
    ).toBe(false);
    expect(
      items.find((item) => item.textContent?.includes("Roadmaps"))?.hasAttribute("aria-current"),
    ).toBe(false);
    expect(items.find((item) => item.textContent?.includes("Tasks"))?.getAttribute("href")).toBe(
      "/spaces/space-1/planner/tasks/board",
    );

    const library = container.querySelector('[data-space-tool="library"] button[aria-label="Library"]');
    expect(
      Boolean(
        destinations &&
        library &&
        destinations.compareDocumentPosition(library) & Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);

    await act(async () => trigger?.click());
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector('[role="group"][aria-label="Planner destinations"]')).toBeNull();

    await act(async () => trigger?.click());
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");

    await act(async () => {
      useWorkspaceStore.setState({
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
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    expect(
      container.querySelector('[role="group"][aria-label="Planner destinations"]'),
    ).not.toBeNull();

    await act(async () => trigger?.click());
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    await act(async () => trigger?.click());
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector('[role="group"][aria-label="Planner destinations"]')).toBeNull();
  });

  it("expands Planner inline without creating a floating menu", async () => {
    await renderNavigator();

    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-space-tool="planner"] button[aria-label="Planner"]',
    );
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector('a[aria-label="Planner"]')).toBeNull();

    await act(async () => trigger?.click());

    const navigation = container.querySelector("nav");
    const destinations = navigation?.querySelector(
      '[role="group"][aria-label="Planner destinations"]',
    );
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    expect(destinations).not.toBeNull();
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
    const planner = navigation?.querySelector('[data-space-tool="planner"]');
    const library = navigation?.querySelector('[data-space-tool="library"]');
    expect(planner).not.toBeNull();
    expect(library).not.toBeNull();
    expect(
      planner!.compareDocumentPosition(library!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("moves Social, Journal, and Library destinations into inline disclosures", async () => {
    useWorkspaceStore.setState({
      activeScopeKey: "space:space-1",
      layout: {
        focusedPaneId: "pane-1",
        root: {
          type: "leaf",
          id: "pane-1",
          activeTabId: "tab-1",
          tabs: [
            {
              ...spaceTab,
              groupKey: "space:space-1:notes",
              instanceKey: "space-1:notes",
              title: "Journal",
              route: "/spaces/space-1/notes",
            },
          ],
        },
      },
    });
    await renderNavigator("/spaces/space-1/notes");

    const journalDestinations = container.querySelector(
      '[role="group"][aria-label="Journal destinations"]',
    );
    const journalDisclosure = journalDestinations?.closest('[data-space-tool="journal"]');
    expect(journalDisclosure).not.toBeNull();
    const journalItems = [...(journalDestinations?.querySelectorAll<HTMLAnchorElement>("a") ?? [])];
    expect(journalItems.map((item) => item.textContent?.trim())).toEqual(["Notes", "Drawings"]);
    expect(featureIconNames(journalDestinations)).toEqual(["notes", "drawings"]);
    expect(journalItems[0]?.getAttribute("aria-current")).toBe("page");

    const libraryTrigger = container.querySelector<HTMLButtonElement>(
      '[data-space-tool="library"] button[aria-label="Library"]',
    );
    await act(async () => libraryTrigger?.click());
    expect(
      [...container.querySelectorAll('[aria-label="Library destinations"] a')].map((item) =>
        item.textContent?.trim(),
      ),
    ).toEqual(["All items", "Favorites", "Collections", "Albums", "Recently deleted"]);
    expect(
      featureIconNames(container.querySelector('[aria-label="Library destinations"]')),
    ).toEqual(["all-items", "favorites", "collections", "albums", "deleted"]);
  });

  it("keeps Explorer and Transfers inside the Files disclosure", async () => {
    useWorkspaceStore.setState({
      layout: {
        focusedPaneId: "pane-1",
        root: {
          type: "leaf",
          id: "pane-1",
          activeTabId: "transfers-tab",
          tabs: [
            spaceTab,
            {
              id: "transfers-tab",
              surfaceId: "official-app",
              groupKey: "app:files",
              instanceKey: "files",
              title: "Transfers",
              route: "/apps/files?view=transfers",
              sidebarVisible: true,
              state: {},
              createdAt: 2,
              lastFocusedAt: 2,
            },
          ],
        },
      },
    });
    await renderNavigator("/apps/files?view=transfers");

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Files"][data-navigator-disclosure-trigger="true"]',
    );
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    const triggerClasses = trigger?.className.split(/\s+/) ?? [];
    expect(triggerClasses).toContain("box-border");
    expect(triggerClasses).toContain(
      "grid-cols-[var(--navigation-primary-icon-slot,18px)_minmax(0,1fr)]",
    );
    expect(triggerClasses).not.toContain("hover:bg-charcoal-active");
    expect(triggerClasses).not.toContain("hover:text-cream");

    const destinations = container.querySelector('[role="group"][aria-label="Files destinations"]');
    const items = [...(destinations?.querySelectorAll<HTMLAnchorElement>("a") ?? [])];
    expect(items.map((item) => item.textContent?.trim())).toEqual(["Explorer", "Transfers"]);
    expect(items[1]?.getAttribute("href")).toBe("/apps/files?view=transfers");
    expect(items[1]?.getAttribute("aria-current")).toBe("page");
    expect(featureIconNames(destinations)).toEqual(["explorer", "transfers"]);
    expect(destinations?.className).toContain("gap-[var(--navigation-tree-gap)]");
    expect(items.every((item) => item.className.includes("h-7"))).toBe(true);
    expect(items.every((item) => item.querySelector('[data-tree-branch="true"]'))).toBe(true);
    expect(items.every((item) => item.querySelector('[data-tree-row-surface="true"]'))).toBe(true);
    expect(
      items.every((item) =>
        item.querySelector('[data-tree-row-surface="true"]')?.className.includes("pl-1.5"),
      ),
    ).toBe(true);
    expect(
      items.every((item) =>
        item.querySelector('[data-tree-row-surface="true"]')?.className.includes("pr-2"),
      ),
    ).toBe(true);
    expect(
      items.every((item) =>
        item
          .querySelector('[data-tree-row-surface="true"]')
          ?.className.includes("group-hover/tree-row:bg-charcoal-card"),
      ),
    ).toBe(true);
    expect(
      items[items.length - 1]
        ?.querySelector('[data-tree-branch="true"]')
        ?.getAttribute("data-tree-branch-end"),
    ).toBe("true");
    expect(items.find((item) => item.textContent?.includes("Explorer"))?.getAttribute("href")).toBe(
      "/apps/files",
    );
    expect(
      items.find((item) => item.textContent?.includes("Transfers"))?.getAttribute("aria-current"),
    ).toBe("page");
    expect(
      container.querySelector(
        'section[aria-label="Primary navigation"] > a[aria-label="Transfers"]',
      ),
    ).toBeNull();

    await act(async () => {
      useWorkspaceStore.setState({
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
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");

    await act(async () => trigger?.click());
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    await act(async () => trigger?.click());
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector('[role="group"][aria-label="Files destinations"]')).toBeNull();
  });

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

function featureIconNames(container: Element | null | undefined): Array<string | null> {
  return [...(container?.querySelectorAll<SVGElement>("[data-navigator-feature-icon]") ?? [])].map(
    (icon) => icon.getAttribute("data-navigator-feature-icon"),
  );
}
