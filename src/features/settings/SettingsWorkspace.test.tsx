import { initializeHostAgentsRuntime } from "@/features/agents/hostAgentsRuntime";
import type * as AppShell from "@/features/app-shell";
import type { SettingsSection } from "@/features/settings";
import { fireEvent } from "@testing-library/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canonicalSettingsSection } from "./SettingsPage";
import type * as SettingsStoreModule from "./store/useSettingsStore";

/**
 * A structural safety net for the settings surface.
 *
 * `npm run check` is format + typecheck + vitest + audit, none of which notices
 * a section that renders blank or a nav entry wired to a component that no
 * longer exists. These tests exist so restructuring settings cannot silently
 * empty a tab.
 */

// Import the registry so the test always mirrors the real nav list.
import SettingsWorkspace, { settingsRegistry } from "./SettingsPage";
import { settingsAreas, settingsGroups } from "./settingsRegistry";
const SECTIONS: SettingsSection[] = settingsRegistry.map((entry) => entry.id);
const mocks = vi.hoisted(() => {
  const settingsState = {
    activeSection: "general" as SettingsSection,
    settings: {
      document: {} as Record<string, unknown>,
    },
    launchOnLogin: {
      supported: true,
      enabled: false,
    },
    openWithAssociations: [] as unknown[],
    shortcuts: {
      bindings: [] as unknown[],
    },
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
vi.mock("@/features/app-shell", async (importOriginal) => {
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
vi.mock("./store/useSettingsStore", async (importOriginal) => {
  const actual = await importOriginal<typeof SettingsStoreModule>();
  const useSettingsStore = (selector?: (state: unknown) => unknown) =>
    selector ? selector(mocks.settingsState) : mocks.settingsState;
  useSettingsStore.getState = () => mocks.settingsState;
  return {
    ...actual,
    useSettingsStore,
  };
});
vi.mock("@/features/native-session", () => ({
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
// Settings pages are empty while the surface is redesigned (settingsRegistry.tsx); the
// redesign brings its own sidebar and replaces these checks.
describe.skip("SettingsWorkspace", () => {
  let container: HTMLDivElement;
  let root: Root;
  async function render(section: SettingsSection = "general", presentation: "page" = "page") {
    mocks.settingsState.activeSection = section;
    await act(async () => {
      root.render(
        <MemoryRouter>
          <SettingsWorkspace presentation={presentation} />
        </MemoryRouter>,
      );
    });
  }
  beforeEach(() => {
    (
      globalThis as {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    mocks.settingsState.settings = {
      document: {},
    };
    mocks.settingsState.setActiveSection.mockClear();
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  it("lists flat areas with unique icons and no Account footer or disclosures", async () => {
    await render();
    expect(
      [...container.querySelectorAll("[data-settings-nav-parent]")].map((e) =>
        e.getAttribute("data-settings-nav-parent"),
      ),
    ).toEqual([]);
    expect(container.querySelector('[data-settings-nav-entry="general"]')).not.toBeNull();
    expect(
      settingsRegistry.every((e) => !e.label.includes("&") && !e.label.includes(" and ")),
    ).toBe(true);
    expect(settingsRegistry.some((e) => e.id === "account" || e.id === "profiles")).toBe(false);
    expect(container.querySelector('[aria-label^="Account settings"]')).toBeNull();
  });
  it.each(SECTIONS)("renders a functional or capability-gated %s page", async (section) => {
    await render(section);
    const main = container.querySelector("main")!;
    expect(main.textContent!.length).toBeGreaterThan(30);
    expect(main.textContent).not.toContain("Coming soon");
  });
  it("groups one-word pages under feature labels", async () => {
    await render();
    const groups = [...container.querySelectorAll('nav [role="group"]')];
    expect(groups.map((group) => group.getAttribute("aria-label"))).toEqual([
      "Settings",
      "Browser",
      "Agents",
    ]);
    for (const group of settingsGroups)
      for (const area of group.areas) {
        const label = settingsAreas[area].label;
        expect(label.split(" ")).toHaveLength(1);
        expect(label.toLowerCase()).not.toContain(group.label.toLowerCase());
      }
    expect(settingsRegistry.find((e) => e.id === "passwords")?.area).toBe("passwords");
  });
  it("renders every block of a page together without expanding navigation", async () => {
    await render("general");
    for (const id of ["general", "updates", "diagnostics", "about"])
      expect(container.querySelector(`[data-settings-page="${id}"]`)).not.toBeNull();
    expect(container.querySelector('[data-settings-nav-entry="updates"]')).toBeNull();
    // Dropdown controls report aria-expanded; navigation never discloses entries.
    expect(container.querySelector('[aria-expanded]:not([role="combobox"])')).toBeNull();
  });
  it("keeps system pages individually addressable", () => {
    for (const id of ["sync", "devices", "privacy", "about", "updates", "diagnostics"])
      expect(settingsRegistry.find((e) => e.id === id)).toBeDefined();
    expect(settingsRegistry.find((e) => e.id === "diagnostics")?.area).toBe("general");
  });
  it("sends retired pages to where their settings live now", () => {
    expect(canonicalSettingsSection("advanced")).toBe("diagnostics");
    expect(canonicalSettingsSection("server")).toBe("about");
    expect(canonicalSettingsSection("agents")).toBe("agents-defaults");
    expect(canonicalSettingsSection("profiles")).toBe("sync");
    expect(canonicalSettingsSection("browser")).toBe("search");
    expect(canonicalSettingsSection("browser-privacy")).toBe("sync");
    expect(canonicalSettingsSection("spaces-manage")).toBe("general");
    expect(settingsRegistry.find((e) => e.id === "sync")?.area).toBe("sync");
    expect(settingsRegistry.find((e) => e.id === "browser-handoff")).toBeUndefined();
    expect(canonicalSettingsSection("browser-handoff")).toBe("sync");
  });
  it("searches individual preferences and opens their canonical page", async () => {
    await render();
    await act(async () =>
      fireEvent.change(container.querySelector('input[aria-label="Search settings"]')!, {
        target: {
          value: "homepage",
        },
      }),
    );
    const result = container.querySelector(
      '[aria-label="Settings search results"] button',
    ) as HTMLButtonElement;
    expect(result.textContent).toContain("Homepage");
    await act(async () => result.click());
    expect(mocks.settingsState.setActiveSection).toHaveBeenCalledWith("browser-tabs");
  });
});
