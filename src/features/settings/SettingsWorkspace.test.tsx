import "@/app/SettingsSections";
import { initializeHostAgentsRuntime } from "@/features/agents/hostAgentsRuntime";
import type * as AppShell from "@/app/shell";
import type { SettingsSection } from "@/features/settings";
import { fireEvent } from "@testing-library/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as SettingsStoreModule from "./preferences/useSettingsStore";

/**
 * A structural safety net for the settings surface.
 *
 * `npm run check` is format + typecheck + vitest + audit, none of which notices
 * a section that renders blank or a nav entry wired to a component that no
 * longer exists. These tests exist so restructuring settings cannot silently
 * empty a tab.
 */

// Import the registry so the test always mirrors the real nav list.
import SettingsWorkspace from "./SettingsPage";
import { settingsAreaEntry, settingsGroups } from "./settingsRegistry";
const PAGES: SettingsSection[] = settingsGroups.flatMap((group) =>
  group.areas.map((area) => settingsAreaEntry(area)!.id),
);
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
vi.mock("./preferences/useSettingsStore", async (importOriginal) => {
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
    const groups = [...container.querySelectorAll('nav [role="group"]')];
    expect(groups.map((group) => group.getAttribute("aria-label"))).toEqual([
      "Account",
      "App",
      "Agents",
    ]);
    const entries = [...container.querySelectorAll("[data-settings-nav-entry]")];
    expect(entries.map((entry) => entry.getAttribute("data-settings-nav-entry"))).toEqual(PAGES);
    expect(container.querySelector('[aria-current="page"]')?.textContent).toBe("General");
    expect(container.querySelector('[aria-label^="Account settings"]')).toBeNull();
    expect(container.querySelector('[aria-expanded]:not([role="combobox"])')).toBeNull();
  });

  it.each(PAGES)("renders the %s page with content", async (section) => {
    await render(section);
    const main = container.querySelector("main")!;
    expect(main.textContent!.length).toBeGreaterThan(20);
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
    expect(container.querySelector('[aria-current="page"]')?.textContent).toBe("General");
    expect(container.querySelector('[data-settings-page="updates"]')).not.toBeNull();
  });

  it("selects a page from the sidebar", async () => {
    await render();
    await act(async () =>
      (container.querySelector('[data-settings-nav-entry="advanced"]') as HTMLElement).click(),
    );
    expect(mocks.settingsState.setActiveSection).toHaveBeenCalledWith("advanced", undefined);
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
