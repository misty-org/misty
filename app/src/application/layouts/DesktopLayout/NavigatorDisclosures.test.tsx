import { useActivityStore } from "@/features/activity";
import { useAiSurfaceStore } from "@/features/ai-surface";
import { resetInboxAccountState, useInboxStore } from "@/features/inbox";
import { useSpacesStore } from "@/features/spaces";
import {
  dockTabs,
  NAVIGATOR_APP_IDS,
  useNavigatorAppsStore,
  useWorkspaceStore,
} from "@/features/workspace";
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GlobalNavigator } from "./GlobalNavigator";
import { spaceFixture, spaceTab } from "./GlobalNavigator.testFixtures";

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
    resetInboxAccountState();
    useNavigatorAppsStore.setState({
      appIdsByAccount: { "account-1": [...NAVIGATOR_APP_IDS] },
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
              surfaceId: "inbox",
              groupKey: "tool:inbox",
              instanceKey: "inbox",
              title: "Inbox",
              route: "/inbox?provider=microsoft",
              sidebarVisible: true,
              state: {},
              createdAt: 1,
              lastFocusedAt: 1,
            },
          ],
        },
      },
    });

    await renderNavigator("/inbox?provider=microsoft");

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
    expect(container.querySelector('[data-navigator-feature-icon="gmail"]')).toBeNull();
    expect(container.querySelector('[data-navigator-feature-icon="outlook"]')).toBeNull();
    const gmailIcon = container.querySelector('[data-mail-provider-icon="gmail"]');
    const outlookIcon = container.querySelector('[data-mail-provider-icon="outlook"]');
    expect(gmailIcon).not.toBeNull();
    expect(outlookIcon).not.toBeNull();
    expect(gmailIcon?.classList.contains("brightness-0")).toBe(true);
    expect(gmailIcon?.classList.contains("invert")).toBe(true);
    expect(outlookIcon?.classList.contains("brightness-0")).toBe(true);
    expect(outlookIcon?.classList.contains("invert")).toBe(true);

    await act(async () => useInboxStore.setState({ selectedProvider: "" }));

    expect(useInboxStore.getState().selectedProvider).toBe("microsoft");
  });

  it("shows Chat and Automations as destinations under Agents", async () => {
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
              surfaceId: "agents",
              groupKey: "tool:agents",
              instanceKey: "agents",
              title: "Agents",
              route: "/agents?view=automations",
              sidebarVisible: true,
              state: {},
              createdAt: 1,
              lastFocusedAt: 1,
            },
          ],
        },
      },
    });

    await renderNavigator("/agents?view=automations");

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Agents"][data-navigator-disclosure-trigger="true"]',
    );
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");

    const items = [
      ...container.querySelectorAll<HTMLAnchorElement>(
        '[role="group"][aria-label="Agents destinations"] a',
      ),
    ];
    expect(items.map((item) => item.textContent?.trim())).toEqual(["Chat", "Automations"]);
    expect(items.map((item) => item.getAttribute("href"))).toEqual([
      "/agents",
      "/agents?view=automations",
    ]);
    expect(
      items
        .find((item) => item.textContent?.trim() === "Chat")
        ?.querySelector(".lucide-bot-message-square"),
    ).not.toBeNull();
    expect(
      items
        .find((item) => item.textContent?.trim() === "Automations")
        ?.getAttribute("aria-current"),
    ).toBe("page");
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
              groupKey: "space:space-1:planner",
              route: "/spaces/space-1/planner/agenda/week?date=2026-08-26",
            },
          ],
        },
      },
    });
    await renderNavigator("/spaces/space-1/planner/agenda/week?date=2026-08-26");

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Planner"][data-navigator-disclosure-trigger="true"]',
    );
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    expect(trigger?.className).toContain("w-full");
    expect(trigger?.title).toBe("Collapse Planner");
    expect(
      trigger?.querySelector('[data-chevron-placement="inline"]')?.parentElement?.className,
    ).toContain("gap-1");

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

    const library = container.querySelector('button[aria-label="Library"]');
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
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector('[role="group"][aria-label="Planner destinations"]')).toBeNull();
  });

  it("expands Planner inline without creating a floating menu", async () => {
    await renderNavigator();

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Planner"][data-navigator-disclosure-trigger="true"]',
    );
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector('a[aria-label="Planner"]')).toBeNull();

    await act(async () => trigger?.click());

    const navigation = container.querySelector('section[aria-label="Primary navigation"]');
    const destinations = navigation?.querySelector(
      '[role="group"][aria-label="Planner destinations"]',
    );
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    expect(destinations).not.toBeNull();
    expect(destinations?.querySelector('a[aria-current="page"]')).toBeNull();
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
    expect(
      navigation
        ?.querySelector('[data-planner-disclosure="true"]')
        ?.nextElementSibling?.getAttribute("data-navigator-disclosure"),
    ).toBe("library");
  });

  it("moves Social, Journal, and Library destinations into inline disclosures", async () => {
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
              groupKey: "space:space-1:social",
              route: "/spaces/space-1/social/instagram",
            },
          ],
        },
      },
    });
    await renderNavigator("/spaces/space-1/social/instagram");

    const socialDestinations = container.querySelector(
      '[role="group"][aria-label="Social destinations"]',
    );
    const socialItems = [...(socialDestinations?.querySelectorAll<HTMLAnchorElement>("a") ?? [])];
    expect(socialItems.map((item) => item.textContent?.trim())).toEqual([
      "Misty",
      "Instagram",
      "Messenger",
      "X",
      "Discord",
    ]);
    expect(socialItems.every((item) => !item.className.includes("hover:bg-charcoal-card"))).toBe(
      true,
    );
    expect(
      socialItems.every((item) =>
        item.querySelector('[data-tree-row-surface="true"]')?.className.includes("ml-1"),
      ),
    ).toBe(true);
    expect(
      socialItems.every((item) =>
        item
          .querySelector('[data-tree-row-surface="true"]')
          ?.className.includes("group-hover/tree-row:bg-charcoal-hover"),
      ),
    ).toBe(true);
    expect(
      socialItems
        .find((item) => item.textContent?.trim() === "Instagram")
        ?.getAttribute("aria-current"),
    ).toBe("page");
    const instagramIcon = socialItems
      .find((item) => item.textContent?.trim() === "Instagram")
      ?.querySelector('[data-social-provider-icon="instagram"]');
    expect(instagramIcon?.querySelector("linearGradient")).not.toBeNull();
    expect(
      socialItems
        .find((item) => item.textContent?.trim() === "Misty")
        ?.querySelector('[data-social-provider-icon="misty"]'),
    ).not.toBeNull();
    expect(
      socialItems
        .find((item) => item.textContent?.trim() === "Misty")
        ?.querySelector<HTMLElement>('[data-social-provider-icon="misty"]')?.style.width,
    ).toBe("18px");
    expect(
      socialItems
        .find((item) => item.textContent?.trim() === "Discord")
        ?.querySelector("svg")
        ?.classList.contains("!size-5"),
    ).toBe(true);
    await act(async () => {
      socialItems.find((item) => item.textContent?.trim() === "X")?.click();
    });
    expect(dockTabs(useWorkspaceStore.getState().layout.root)[0]?.route).toBe(
      "/spaces/space-1/social/x",
    );

    const socialTrigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Social"][data-navigator-disclosure-trigger="true"]',
    );
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

    const journalTrigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Journal"][data-navigator-disclosure-trigger="true"]',
    );
    expect(socialTrigger?.getAttribute("aria-expanded")).toBe("true");
    expect(journalTrigger?.getAttribute("aria-expanded")).toBe("true");
    expect(
      [...container.querySelectorAll('[aria-label="Journal destinations"] a')].map((item) =>
        item.textContent?.trim(),
      ),
    ).toEqual(["Notes", "Drawings"]);
    expect(
      featureIconNames(container.querySelector('[aria-label="Journal destinations"]')),
    ).toEqual(["notes", "drawings"]);

    await act(async () => socialTrigger?.click());
    expect(socialTrigger?.getAttribute("aria-expanded")).toBe("false");

    const libraryTrigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Library"][data-navigator-disclosure-trigger="true"]',
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
              surfaceId: "transfers",
              groupKey: "tool:transfers",
              instanceKey: "transfers",
              title: "Transfers",
              route: "/transfers",
              sidebarVisible: true,
              state: {},
              createdAt: 2,
              lastFocusedAt: 2,
            },
          ],
        },
      },
    });
    await renderNavigator("/transfers");

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Files"][data-navigator-disclosure-trigger="true"]',
    );
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    const triggerClasses = trigger?.className.split(/\s+/) ?? [];
    expect(triggerClasses).not.toContain("hover:bg-charcoal-active");
    expect(triggerClasses).not.toContain("hover:text-cream");

    const destinations = container.querySelector('[role="group"][aria-label="Files destinations"]');
    const items = [...(destinations?.querySelectorAll<HTMLAnchorElement>("a") ?? [])];
    expect(items.map((item) => item.textContent?.trim())).toEqual(["Explorer", "Transfers"]);
    expect(featureIconNames(destinations)).toEqual(["explorer", "transfers"]);
    expect(destinations?.className).toContain("gap-1");
    expect(items.every((item) => item.className.includes("h-7"))).toBe(true);
    expect(items.every((item) => item.querySelector('[data-tree-branch="true"]'))).toBe(true);
    expect(items.every((item) => item.querySelector('[data-tree-row-surface="true"]'))).toBe(true);
    expect(
      items.every((item) =>
        item.querySelector('[data-tree-row-surface="true"]')?.className.includes("ml-1"),
      ),
    ).toBe(true);
    expect(
      items.every((item) =>
        item.querySelector('[data-tree-row-surface="true"]')?.className.includes("pl-1"),
      ),
    ).toBe(true);
    expect(
      items.every((item) =>
        item
          .querySelector('[data-tree-row-surface="true"]')
          ?.className.includes("group-hover/tree-row:bg-charcoal-hover"),
      ),
    ).toBe(true);
    expect(
      items[items.length - 1]
        ?.querySelector('[data-tree-branch="true"]')
        ?.getAttribute("data-tree-branch-end"),
    ).toBe("true");
    expect(items.find((item) => item.textContent?.includes("Explorer"))?.getAttribute("href")).toBe(
      "/files",
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
