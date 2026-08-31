import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MarketplaceBrowser } from "./components/MarketplaceBrowser";
import type { MarketplaceEntry } from "./components/types";

function entry(overrides: Partial<MarketplaceEntry> & { id: string }): MarketplaceEntry {
  return {
    name: `Plugin ${overrides.id}`,
    version: "0.3.0",
    author: "Misty",
    overview: "Find the files and types consuming space in one local folder.",
    installed: false,
    enabled: false,
    verified: true,
    capabilities: ["Recursive read-only folder totals"],
    whereItAppears: ["Workspace app tab from Files"],
    permissions: ["Read-only access to one selected local folder"],
    gettingStarted: ["Install it."],
    changelog: ["v0.3.0 - Initial production release."],
    includedTools: [],
    links: [],
    kind: "app",
    placement: { views: ["files"], openMode: "tab", requiresSelection: true },
    ...overrides,
  };
}

const marketplace = [
  entry({ id: "storage-report", name: "Storage Report" }),
  entry({ id: "themes", name: "Themes", installed: true, enabled: true }),
  entry({ id: "backups", name: "Backups", installed: true, enabled: false }),
];

function cardTitles(container: HTMLElement) {
  return [...container.querySelectorAll("[data-marketplace-entry-name]")].map(
    (node) => node.textContent,
  );
}

describe("MarketplaceBrowser", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function render(node: React.ReactNode) {
    await act(async () => {
      root.render(node);
    });
  }

  it("renders a featured storefront for apps and reserves extensions for future add-ons", async () => {
    await render(
      <MarketplaceBrowser
        marketplacePlugins={marketplace}
        onQueryChange={() => {}}
        onSelect={() => {}}
        query=""
      />,
    );

    expect(cardTitles(container)).toEqual(["Storage Report", "Themes", "Backups"]);
    expect(container.querySelector("h1")?.textContent).toBe("Store");
    expect(container.textContent).toContain("Featured apps");
    expect(container.textContent).toContain("Essential apps");
    expect(container.textContent).toContain("Browse apps");
    expect(container.textContent).toContain("Explore extensions");
    const featuredDestination = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Browse featured"]',
    );
    expect(featuredDestination?.querySelector(".lucide-square-star")).not.toBeNull();
    expect(container.querySelector('button[aria-label="Browse home"]')).toBeNull();
  });

  it("provides a wider resizable sidebar with a persistent bottom toggle", async () => {
    await render(
      <MarketplaceBrowser
        marketplacePlugins={marketplace}
        onQueryChange={() => {}}
        onSelect={() => {}}
        query=""
      />,
    );

    const sidebar = container.querySelector('[data-store-sidebar="true"]');
    const resizer = container.querySelector<HTMLElement>('[data-store-sidebar-resizer="true"]');
    const toggle = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Hide Store sidebar"]',
    );
    const sidebarShell = container.querySelector<HTMLElement>('[data-store-sidebar-shell="true"]');
    expect(sidebarShell?.style.width).toBe("240px");
    expect(sidebar).not.toBeNull();
    expect(resizer?.getAttribute("aria-valuemin")).toBe("220");
    expect(resizer?.getAttribute("aria-valuemax")).toBe("360");
    expect(container.querySelector('[data-store-bottom-bar="true"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Apps are built in.");

    await act(async () => {
      resizer?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "End" }));
    });
    expect(resizer?.getAttribute("aria-valuenow")).toBe("360");
    expect(sidebarShell?.style.width).toBe("360px");

    await act(async () => toggle?.click());
    expect(container.querySelector('[data-store-sidebar="true"]')).toBeNull();
    expect(container.querySelector('button[aria-label="Show Store sidebar"]')).not.toBeNull();
  });

  it("keeps the manual reload fallback quiet and icon-only", async () => {
    await render(
      <MarketplaceBrowser
        marketplacePlugins={marketplace}
        onQueryChange={() => {}}
        onRefresh={() => {}}
        onSelect={() => {}}
        query=""
      />,
    );

    const reload = container.querySelector('button[aria-label="Reload Store"]');
    expect(reload).not.toBeNull();
    expect(reload?.textContent).toBe("");
  });

  it("opens the detail dialog only for the selected app", async () => {
    await render(
      <MarketplaceBrowser
        marketplacePlugins={marketplace}
        onQueryChange={() => {}}
        onSelect={() => {}}
        query=""
      />,
    );
    expect(document.querySelector('[data-slot="dialog-content"]')).toBeNull();

    await render(
      <MarketplaceBrowser
        marketplacePlugins={marketplace}
        onQueryChange={() => {}}
        onSelect={() => {}}
        query=""
        selectedPluginId="storage-report"
      />,
    );

    const dialog = document.querySelector('[data-slot="dialog-content"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain("Read-only access to one selected local folder");
  });

  it("reports the selected app when a card is opened", async () => {
    const selected: string[] = [];
    await render(
      <MarketplaceBrowser
        marketplacePlugins={marketplace}
        onQueryChange={() => {}}
        onSelect={(pluginId) => selected.push(pluginId)}
        query=""
      />,
    );

    const detailButton = [...container.querySelectorAll("button")].find((node) =>
      node.textContent?.includes("View Themes details"),
    );
    await act(async () => {
      detailButton?.click();
    });

    expect(selected).toEqual(["themes"]);
  });

  it("filters by query and narrows the installed tab", async () => {
    await render(
      <MarketplaceBrowser
        installedPlugins={marketplace.filter((plugin) => plugin.installed)}
        marketplacePlugins={marketplace}
        onQueryChange={() => {}}
        onSelect={() => {}}
        query="backups"
      />,
    );

    expect(cardTitles(container)).toEqual(["Backups"]);
  });

  it("paginates results in groups of 50", async () => {
    const catalog = Array.from({ length: 120 }, (_, index) =>
      entry({ id: `app-${index + 1}`, name: `App ${index + 1}` }),
    );
    await render(
      <MarketplaceBrowser
        marketplacePlugins={catalog}
        onQueryChange={() => {}}
        onSelect={() => {}}
        query=""
      />,
    );

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Browse apps"]')?.click();
    });

    expect(cardTitles(container)).toHaveLength(50);
    expect(container.textContent).toContain("1–50 of 120");
    expect(
      container.querySelector<HTMLButtonElement>('button[aria-label="Previous page"]')?.disabled,
    ).toBe(true);

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Next page"]')?.click();
    });

    expect(cardTitles(container)).toHaveLength(50);
    expect(cardTitles(container)[0]).toBe("App 51");
    expect(container.textContent).toContain("51–100 of 120");
  });

  it("gives Apps and Extensions distinct storefront destinations and icons", async () => {
    const catalog = [
      entry({ id: "builtin:journal", kind: "builtin", name: "Journal" }),
      entry({ id: "storage-report", kind: "app", name: "Storage Report" }),
    ];
    await render(
      <MarketplaceBrowser
        marketplacePlugins={catalog}
        onQueryChange={() => {}}
        onSelect={() => {}}
        query=""
      />,
    );

    const builtInIcon = container.querySelector<HTMLElement>('[data-app-icon="journal"]');
    expect(builtInIcon?.className.split(/\s+/)).toContain("text-cream-bright");
    expect(builtInIcon?.className).not.toMatch(/text-(?:avatar|agent)-/);

    const appsDestination = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Browse apps"]',
    );
    const extensionsDestination = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Browse extensions"]',
    );
    expect(appsDestination?.querySelector(".lucide-layout-grid")).not.toBeNull();
    expect(extensionsDestination?.querySelector(".lucide-blocks")).not.toBeNull();
    await act(async () => appsDestination?.click());
    expect(cardTitles(container)).toEqual(["Journal", "Storage Report"]);
    const fallbackIcon = container.querySelector<HTMLElement>(
      '[data-plugin-icon="storage_report"]',
    );
    expect(fallbackIcon?.className.split(/\s+/)).toContain("text-cream-bright");
    expect(fallbackIcon?.style.backgroundColor).toBe("");
    expect(fallbackIcon?.style.color).toBe("");

    await act(async () => extensionsDestination?.click());
    expect(cardTitles(container)).toEqual([]);
    expect(container.textContent).toContain("No app extensions are available yet.");
  });
});
