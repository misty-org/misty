import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SettingsSection } from "@/features/settings";
import type * as AppShell from "@/features/app-shell";
import type * as FileSearch from "@/features/files/search";
import { NAVIGATOR_APP_IDS } from "@/features/workspace";
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
import { settingsRegistry } from "./SettingsPage";

const SECTIONS: SettingsSection[] = settingsRegistry.map((entry) => entry.id);

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
    expect(nav?.querySelectorAll("[data-settings-nav-entry]").length ?? 0).toBe(SECTIONS.length);
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

  it("places server connection management on its own settings page", async () => {
    await renderWorkspace("server");

    expect(container.querySelector("main h1")?.textContent).toBe("Server");
    expect(container.querySelector("main")?.textContent).toContain("Connection");
    expect(container.querySelector("main")?.textContent).toContain("Misty Hosted");

    await renderWorkspace("advanced");
    expect(container.querySelector("main")?.textContent).not.toContain("Deployment");
  });

  it.each(["models", "extensions"] as const)(
    "labels the unfinished %s settings page as coming soon",
    async (section) => {
      await renderWorkspace(section);

      const label = settingsRegistry.find((entry) => entry.id === section)?.label;
      expect(container.querySelector("main h1")?.textContent).toBe(label);
      expect(container.querySelector("main")?.textContent).toContain("coming soon...");
    },
  );

  it("marks the selected settings section the way the global navigator does", async () => {
    await renderWorkspace("general");

    const nav = container.querySelector('nav[aria-label="Settings sections"]');
    const activeItem = nav?.querySelector('button[aria-current="page"]');
    const inactiveItem = nav?.querySelector('[data-settings-nav-entry]:not([aria-current="page"])');
    const activeSurface = activeItem?.querySelector('[data-settings-nav-surface="true"]');
    const inactiveSurface = inactiveItem?.querySelector('[data-settings-nav-surface="true"]');

    // Compared as class tokens, not substrings: every row also carries
    // hover/selected color utilities share prefixes, which a substring check
    // would match on both.
    const classesOf = (node: Element | null | undefined) => (node?.className ?? "").split(/\s+/);

    // The fill begins where the tree branch ends, while the outer button keeps
    // the full hit area and focus target.
    expect(classesOf(activeItem)).not.toContain("bg-charcoal-card");
    expect(classesOf(activeSurface)).toContain(
      "group-aria-[current=page]/tree-row:bg-charcoal-active",
    );
    expect(classesOf(activeItem)).toContain("text-cream-bright");
    expect(classesOf(inactiveItem)).toContain("text-cream-muted");
    expect(classesOf(inactiveSurface)).not.toContain("bg-charcoal-active");
    // The old edge marker must not come back alongside the fill.
    expect(classesOf(activeItem)).not.toContain("misty-active-marker-side");
    expect(classesOf(inactiveItem)).not.toContain("misty-marker-host");
  });

  it("captions each nav group", async () => {
    await renderWorkspace("general");

    const nav = container.querySelector('nav[aria-label="Settings sections"]');
    const captions = [...(nav?.querySelectorAll("h2") ?? [])].map((node) => node.textContent);
    expect(captions).toEqual(["Preferences", "Agents", "System"]);
  });

  it("keeps installable-app settings out of Misty Core", () => {
    expect(settingsRegistry.some((entry) => NAVIGATOR_APP_IDS.includes(entry.id as never))).toBe(
      false,
    );
    expect(
      settingsRegistry.some((entry) => entry.id === "transfers" || entry.id === "search"),
    ).toBe(false);
    expect(
      settingsRegistry.filter((entry) => entry.group === "agents").map((entry) => entry.id),
    ).toEqual(["models", "misty"]);
  });

  it("collapses and expands each nav group from its heading", async () => {
    await renderWorkspace("general");

    const nav = container.querySelector('nav[aria-label="Settings sections"]');
    const preferencesToggle = nav?.querySelector<HTMLButtonElement>(
      'button[aria-label="Collapse Preferences settings"]',
    );

    expect(preferencesToggle?.getAttribute("aria-expanded")).toBe("true");

    await act(async () => {
      preferencesToggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(
      nav
        ?.querySelector('button[aria-label="Expand Preferences settings"]')
        ?.getAttribute("aria-expanded"),
    ).toBe("false");
    expect(nav?.querySelector('[data-settings-nav-entry="general"]')).toBeNull();
    expect(nav?.querySelector('[data-settings-nav-entry="models"]')).not.toBeNull();
    expect(nav?.querySelector('[data-settings-nav-entry="server"]')).not.toBeNull();

    await act(async () => {
      nav
        ?.querySelector<HTMLButtonElement>('button[aria-label="Expand Preferences settings"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(nav?.querySelector('[data-settings-nav-entry="general"]')).not.toBeNull();
  });

  it("uses monochrome Lucide icons for every settings entry", async () => {
    await renderWorkspace("general");
    for (const entry of settingsRegistry) {
      const row = container.querySelector(`[data-settings-nav-entry="${entry.id}"]`);
      expect(row?.querySelector("svg.lucide"), entry.id).not.toBeNull();
      expect(
        row?.querySelector("img, linearGradient, [class*='text-avatar-'], [class*='text-agent-']"),
        entry.id,
      ).toBeNull();
      expect(row?.querySelector("svg")?.getAttribute("stroke")).toBe("currentColor");
    }
  });

  it("uses the concise Help label", async () => {
    await renderWorkspace("support");

    expect(container.querySelector("main h1")?.textContent).toBe("Help");
  });

  it("uses normal letter spacing for nav group titles", async () => {
    await renderWorkspace("general");

    const groupToggle = container.querySelector('nav[aria-label="Settings sections"] h2 button');
    const classes = (groupToggle?.className ?? "").split(/\s+/);

    expect(classes).toContain("tracking-normal");
    expect(classes).toContain("text-[13px]");
    expect(classes).toContain("gap-2.5");
    expect(groupToggle?.querySelector("[data-settings-group-icon]")).not.toBeNull();
    expect(classes).not.toContain("tracking-[0.04em]");
    expect(classes).toContain("hover:bg-charcoal-card");
    expect(classes).toContain("hover:text-cream-bright");
    expect(groupToggle?.querySelector('[data-chevron-placement="inline"]')).not.toBeNull();
  });

  it("draws an indented hierarchy rail beside grouped settings", async () => {
    await renderWorkspace("general");

    const general = container.querySelector('[data-settings-nav-entry="general"]');
    const classes = (general?.className ?? "").split(/\s+/);
    const surfaceClasses = (
      general?.querySelector('[data-settings-nav-surface="true"]')?.className ?? ""
    ).split(/\s+/);

    expect(classes).toContain("ml-[27px]");
    expect(classes).toContain("mr-2");
    expect(classes).toContain("h-7");
    expect(classes).toContain("text-[13px]");
    expect(surfaceClasses).toContain("ml-1");
    expect(surfaceClasses).toContain("gap-2");
    expect(surfaceClasses).toContain("px-2");
    expect(general?.querySelector('[data-tree-branch="true"]')).not.toBeNull();
    expect(general?.querySelector('[data-tree-branch="true"]')?.className.split(/\s+/)).toContain(
      "-left-2",
    );
    expect(
      general?.querySelector('[data-settings-nav-surface="true"] > span')?.className.split(/\s+/),
    ).toContain("size-5");
    expect(
      general?.querySelector('[data-settings-nav-surface="true"] > span')?.className,
    ).toContain("[&_svg]:!size-[18px]");
    expect(
      container
        .querySelector('[data-settings-nav-entry="shortcuts"] [data-tree-branch="true"]')
        ?.getAttribute("data-tree-branch-end"),
    ).toBe("true");
  });
});
