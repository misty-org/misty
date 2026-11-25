import "@/app/settings_sections";
import { initializeHostAgentsRuntime } from "@/features/agents/host_agents_runtime";
import type * as AppShell from "@/app/shell";
import type { SettingsSection } from "@/features/settings";
import { fireEvent } from "@testing-library/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type * as SettingsStoreModule from "./preferences/use_settings_store";

import SettingsWorkspace from "./SettingsPage";
import { preloadSettingsSections, settingsAreaEntry, settingsGroups } from "./SettingsRegistry";
const PAGES: SettingsSection[] = settingsGroups.flatMap((group) =>
  group.areas.map((area) => settingsAreaEntry(area)!.id),
);
const fromEngines = new Set<SettingsSection>(["engines-channels"]);
const mocks = vi.hoisted(() => {
  const settingsState = {
    activeSection: "general" as SettingsSection,
    focusTarget: { label: "", request: 0 },
    settings: {
      document: {} as Record<string, unknown>,
    },
    launchOnLogin: {
      supported: true,
      enabled: false,
    },
    openWithAssociations: [] as unknown[],
    shortcuts: {},
    working: false,
    error: null,
    message: null,
    setActiveSection: vi.fn(),
    updateSetting: () => {},
    load: () => {},
    removeOpenWithAssociation: () => {},
    setShortcut: () => {},
    saveShortcuts: () => {},
    resetShortcuts: () => {},
  };
  const searchState = {
    status: null,
    error: null,
    initialize: () => Promise.resolve(),
    refreshStatus: () => Promise.resolve(),
    startScan: () => Promise.resolve(),
    cancelScan: () => Promise.resolve(),
  };
  return {
    settingsState,
    searchState,
  };
});
vi.mock("@/app/shell", async (importOriginal) => {
  const actual = await importOriginal<typeof AppShell>();
  const appState = {
    app: null,
    setError: () => {},
    setMessage: () => {},
  };
  const useAppStore = (selector?: (state: unknown) => unknown) =>
    selector ? selector(appState) : appState;
  useAppStore.getState = () => appState;
  return {
    ...actual,
    useAppStore,
  };
});
vi.mock("./preferences/use_settings_store", async (importOriginal) => {
  const actual = await importOriginal<typeof SettingsStoreModule>();
  const useSettingsStore = (selector?: (state: unknown) => unknown) =>
    selector ? selector(mocks.settingsState) : mocks.settingsState;
  useSettingsStore.getState = () => mocks.settingsState;
  return {
    ...actual,
    useSettingsStore,
  };
});
vi.mock("@/features/account/native-session", () => ({
  InstallerCard: () => <div data-testid="installer-card" />,
}));
vi.mock("@/api/assistant/api", () => ({
  assistantApi: {
    frontierModels: async () => ({
      models: [
        {
          id: "model",
          name: "Available model",
          provider_name: "Provider",
          capabilities: ["reasoning"],
          reasoning_levels: ["high", "xhigh"],
        },
      ],
    }),
  },
}));
initializeHostAgentsRuntime();
describe("SettingsWorkspace", () => {
  let container: HTMLDivElement;
  let root: Root;
  async function render(section: SettingsSection = "general") {
    mocks.settingsState.activeSection = section;
    await act(async () => {
      root.render(
        <MemoryRouter>
          <SettingsWorkspace presentation="page" />
        </MemoryRouter>,
      );
    });
  }
  beforeAll(async () => {
    await preloadSettingsSections();
  });
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    mocks.settingsState.settings = { document: {} };
    mocks.settingsState.setActiveSection.mockClear();
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("lists pages under feature groups, without disclosures or an Account footer", async () => {
    await render();
    const groups = [...container.querySelectorAll('nav > [role="group"]')];
    expect(groups.map((group) => group.getAttribute("aria-label"))).toEqual([
      "Account",
      "App",
      "AI",
    ]);
    const entries = [...container.querySelectorAll("[data-settings-nav-entry]")];
    expect(entries.map((entry) => entry.getAttribute("data-settings-nav-entry"))).toEqual(PAGES);
    expect(
      container.querySelector(
        '[data-settings-nav-entry="general"] + [data-slot="nav-branch"] [aria-current="page"]',
      ),
    ).not.toBeNull();
    expect(container.querySelector('[aria-label^="Account settings"]')).toBeNull();
    expect(container.querySelector('[aria-expanded]:not([role="combobox"])')).toBeNull();
  });

  it.each(PAGES)("renders the %s page with content", async (section) => {
    await render(section);
    const main = container.querySelector("main")!;
    if (!fromEngines.has(section)) expect(main.textContent!.length).toBeGreaterThan(20);
    expect(main.querySelector(`[data-settings-page="${section}"]`)).not.toBeNull();
    expect(main.textContent).not.toMatch(/coming soon|in progress|Loading…/i);
  });

  it("renders every block of a page together", async () => {
    await render("general");
    for (const id of ["general", "updates"])
      expect(container.querySelector(`[data-settings-page="${id}"]`)).not.toBeNull();
    expect(container.querySelector('[data-settings-nav-entry="updates"]')).toBeNull();
  });

  it("opens a deep-linked block on its page", async () => {
    await render("updates");
    expect(container.querySelector('[data-settings-nav-entry="general"]')).not.toBeNull();
    expect(container.querySelector('[aria-current="page"]')?.textContent).toBe("Updates");
    expect(container.querySelector('[data-settings-page="updates"]')).not.toBeNull();
  });

  it("selects a page from the sidebar", async () => {
    await render();
    await act(async () =>
      (container.querySelector('[data-settings-nav-entry="network"]') as HTMLElement).click(),
    );
    expect(mocks.settingsState.setActiveSection).toHaveBeenCalledWith("network", undefined);
  });

  it("searches preferences and opens the page that shows the row", async () => {
    await render();
    await act(async () =>
      fireEvent.change(container.querySelector('input[aria-label="Search settings"]')!, {
        target: { value: "reopen" },
      }),
    );
    const result = container.querySelector(
      '[aria-label="Settings search results"] button',
    ) as HTMLButtonElement;
    expect(result.textContent).toContain("Reopen last session");
    await act(async () => result.click());
    expect(mocks.settingsState.setActiveSection).toHaveBeenCalledWith(
      "general",
      "Reopen last session",
    );
  });
});
