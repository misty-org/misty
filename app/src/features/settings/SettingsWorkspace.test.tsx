import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SettingsSection } from "@/features/settings";
import type * as AppShell from "@/features/app-shell";
import type * as FileSearch from "@/features/files/search";
import type * as SettingsStoreModule from "./store/useSettingsStore";

/**
 * A structural safety net for the settings surface.
 *
 * `npm run check` is format + typecheck + vitest + audit, none of which notices
 * a section that renders blank or a nav entry wired to a component that no
 * longer exists. These tests exist so restructuring settings cannot silently
 * empty a tab.
 */

const SECTIONS: SettingsSection[] = [
  "general",
  "app",
  "agent",
  "appearance",
  "notifications",
  "privacy",
  "transfers",
  "search",
  "shortcuts",
  "advanced",
];

const mocks = vi.hoisted(() => {
  const settingsState = {
    activeSection: "general" as SettingsSection,
    settings: { document: {} as Record<string, unknown> },
    launchOnLogin: { supported: true, enabled: false },
    openWithAssociations: [] as unknown[],
    shortcuts: { bindings: [] as unknown[] },
    working: false,
    error: null,
    message: null,
    setActiveSection: () => {},
    updateSetting: () => {},
    load: () => {},
    removeOpenWithAssociation: () => {},
    setShortcut: () => {},
    saveShortcuts: () => {},
  };
  const searchState = {
    status: null,
    error: null,
    initialize: () => Promise.resolve(),
    refreshStatus: () => Promise.resolve(),
    startScan: () => Promise.resolve(),
    cancelScan: () => Promise.resolve(),
  };
  return { settingsState, searchState };
});

vi.mock("@/features/app-shell", async (importOriginal) => {
  const actual = await importOriginal<typeof AppShell>();
  const appState = { app: null, setError: () => {}, setMessage: () => {} };
  const useAppStore = (selector?: (state: unknown) => unknown) =>
    selector ? selector(appState) : appState;
  useAppStore.getState = () => appState;
  return { ...actual, useAppStore };
});

vi.mock("./store/useSettingsStore", async (importOriginal) => {
  const actual = await importOriginal<typeof SettingsStoreModule>();
  const useSettingsStore = (selector?: (state: unknown) => unknown) =>
    selector ? selector(mocks.settingsState) : mocks.settingsState;
  useSettingsStore.getState = () => mocks.settingsState;
  return { ...actual, useSettingsStore };
});

vi.mock("@/features/files/search", async (importOriginal) => {
  const actual = await importOriginal<typeof FileSearch>();
  const useSearchStore = (selector?: (state: unknown) => unknown) =>
    selector ? selector(mocks.searchState) : mocks.searchState;
  useSearchStore.getState = () => mocks.searchState;
  return { ...actual, useSearchStore };
});

vi.mock("@/features/installer", () => ({
  InstallerCard: () => <div data-testid="installer-card" />,
}));

import SettingsWorkspace from "./SettingsPage";

describe("SettingsWorkspace", () => {
  let container: HTMLDivElement;
  let root: Root;

  async function renderWorkspace(section: SettingsSection) {
    mocks.settingsState.activeSection = section;
    await act(async () => {
      root.render(<SettingsWorkspace />);
    });
  }

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mocks.settingsState.settings = { document: {} };
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("renders a nav entry for every section the content router handles", async () => {
    await renderWorkspace("general");

    const nav = container.querySelector('nav[aria-label="Settings sections"]');
    expect(nav).not.toBeNull();
    // A nav entry pointing at a section the router cannot render is exactly the
    // failure a split introduces.
    expect(nav?.querySelectorAll("button").length ?? 0).toBe(SECTIONS.length);
  });

  it.each(SECTIONS)("renders non-empty content for the %s section", async (section) => {
    await renderWorkspace(section);

    const body = container.querySelector("main") ?? container;
    const navText =
      container.querySelector('nav[aria-label="Settings sections"]')?.textContent ?? "";
    const bodyText = (body.textContent ?? "").replace(navText, "").trim();
    // "Not blank" is the assertion that matters: a section wired to a deleted
    // component still type-checks but renders nothing.
    expect(bodyText.length).toBeGreaterThan(0);
  });

  it("titles the surface with the active section", async () => {
    await renderWorkspace("appearance");

    const heading = container.querySelector("h1");
    expect(heading?.textContent).toBe("Appearance");
  });

  it("marks the selected settings section with the active edge marker", async () => {
    await renderWorkspace("general");

    const nav = container.querySelector('nav[aria-label="Settings sections"]');
    const activeItem = nav?.querySelector('button[aria-current="page"]');
    const inactiveItem = nav?.querySelector('button:not([aria-current="page"])');

    expect(activeItem?.className).toContain("misty-active-marker-side");
    expect(activeItem?.className).toContain("text-cream-bright");
    expect(inactiveItem?.className).toContain("misty-marker-host");
    expect(inactiveItem?.className).not.toContain("misty-active-marker-side");
  });
});
