import { useActivityStore } from "@/features/activity";
import { useAiSurfaceStore } from "@/features/ai-surface";
import { useSpacesStore } from "@/features/spaces";
import { useNavigatorAppsStore, useWorkspaceStore } from "@/features/workspace";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GlobalNavigator } from "./GlobalNavigator";
import { seedNavigatorApps, spaceFixture, spaceTab } from "./GlobalNavigator.testFixtures";

vi.mock("@/features/auth", () => ({
  useAuth: () => ({ user: { id: "account-1", email: "owner@example.com" }, accounts: [] }),
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
          activeViewId: "tab-1",
          views: [spaceTab],
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
  });

  it.each([
    ["agents", "/agents", "Agents"],
    ["scheduled", "/scheduled", "Agents"],
    ["browser", "/browser", "Browser"],
  ] as const)(
    "highlights the focused %s view without nested destinations",
    async (surfaceId, route, label) => {
      useWorkspaceStore.setState({
        layout: {
          focusedPaneId: "pane-1",
          root: {
            type: "leaf",
            id: "pane-1",
            activeViewId: "tab-1",
            views: [{ ...spaceTab, surfaceId, route, groupKey: `tool:${surfaceId}` }],
          },
        },
      });
      await renderNavigator();
      const link = container.querySelector(`a[aria-label="${label}"]`);
      expect(link?.getAttribute("aria-current")).toBe("page");
      expect(container.querySelector(`[aria-label="${label} destinations"]`)).toBeNull();
      await act(async () =>
        useWorkspaceStore.setState({
          layout: {
            focusedPaneId: "pane-1",
            root: {
              type: "leaf",
              id: "pane-1",
              activeViewId: "tab-1",
              views: [{ ...spaceTab, surfaceId: "space", route: "/spaces/space-1/notes" }],
            },
          },
        }),
      );
      expect(link?.hasAttribute("aria-current")).toBe(false);
      expect(container.querySelector('[aria-label="Family"]')?.getAttribute("aria-current")).toBe(
        "page",
      );
    },
  );

  it("persists the Space stack disclosure without hiding the global tools", async () => {
    localStorage.removeItem("misty:navigator-spaces-open");
    await renderNavigator();
    const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Spaces"]');
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    await act(async () => trigger?.click());
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    expect(localStorage.getItem("misty:navigator-spaces-open")).toBe("false");
    expect(container.querySelector('[aria-label="Agents"]')).not.toBeNull();
    expect(container.querySelector("#navigator-spaces")?.hasAttribute("inert")).toBe(true);
    await act(async () => trigger?.click());
    expect(localStorage.getItem("misty:navigator-spaces-open")).toBe("true");
    expect(container.querySelector("#navigator-spaces")?.hasAttribute("inert")).toBe(false);
  });

  async function renderNavigator(initialEntry = "/spaces/space-1/notes") {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[initialEntry]}>
          <GlobalNavigator
            profileOpen={false}
            settingsOpen={false}
            onProfileOpenChange={() => undefined}
            onOpenAccountSettings={() => undefined}
            onSettingsClick={() => undefined}
          />
        </MemoryRouter>,
      );
    });
  }
});
