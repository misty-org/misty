import { initializeHostAgentsRuntime } from "@/features/agents/hostAgentsRuntime";
import type * as AppShell from "@/features/app-shell";
import type * as FileSearch from "@/features/files/workspace/search";
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
vi.mock("@/features/files/workspace/search", async (importOriginal) => {
  const actual = await importOriginal<typeof FileSearch>();
  const useSearchStore = (selector?: (state: unknown) => unknown) =>
    selector ? selector(mocks.searchState) : mocks.searchState;
  useSearchStore.getState = () => mocks.searchState;
  return {
    ...actual,
    useSearchStore,
  };
});
vi.mock("@/features/installer", () => ({
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
  it("has exactly five groups and no combined page labels or account page", async () => {
    await render();
    expect([...container.querySelectorAll("nav h2")].map((e) => e.textContent)).toEqual([
      "App",
      "Browser",
      "Spaces",
      "Files",
      "Agents",
    ]);
    expect(
      settingsRegistry.every((e) => !e.label.includes("&") && !e.label.includes(" and ")),
    ).toBe(true);
    expect(settingsRegistry.some((e) => e.id === "account")).toBe(false);
    expect(container.textContent).toContain("Account settings");
  });
  it.each(SECTIONS)("renders a functional or capability-gated %s page", async (section) => {
    await render(section);
    const main = container.querySelector("main")!;
    expect(main.textContent!.length).toBeGreaterThan(30);
    expect(main.textContent).not.toContain("Coming soon");
  });
  it("opens the selected group and allows independent collapse", async () => {
    await render("browser");
    const toggle = container.querySelector<HTMLButtonElement>(
      '[aria-label="Collapse Browser settings"]',
    )!;
    expect(container.querySelector('[data-settings-nav-entry="browser-downloads"]')).not.toBeNull();
    await act(async () => toggle.click());
    expect(container.querySelector('[data-settings-nav-entry="browser-downloads"]')).toBeNull();
  });
  it("shows actual available models", async () => {
    await render("models");
    expect(container.querySelector("main")?.textContent).toContain("Available model");
  });
  it("keeps system pages individually addressable", () => {
    for (const id of [
      "profiles",
      "sync",
      "server",
      "devices",
      "privacy",
      "updates",
      "about",
      "diagnostics",
    ])
      expect(settingsRegistry.find((e) => e.id === id)?.group).toBe("app");
  });
  it("preserves aliases and separates browser handoff from settings sync", () => {
    expect(canonicalSettingsSection("advanced")).toBe("diagnostics");
    expect(canonicalSettingsSection("agents")).toBe("agents-defaults");
    expect(settingsRegistry.find((e) => e.id === "sync")?.group).toBe("app");
    expect(settingsRegistry.find((e) => e.id === "browser-handoff")?.group).toBe("browser");
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
    expect(mocks.settingsState.setActiveSection).toHaveBeenCalledWith("browser");
  });
});
