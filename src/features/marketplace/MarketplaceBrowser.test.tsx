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
    whereItAppears: ["Files extension popup"],
    permissions: ["Read-only access to one selected local folder"],
    gettingStarted: ["Install it."],
    changelog: ["v0.3.0 - Initial production release."],
    includedTools: [],
    links: [],
    placement: { views: ["files"], openMode: "popup", requiresSelection: true },
    ...overrides,
  };
}

const marketplace = [
  entry({ id: "storage-report", name: "Storage Report" }),
  entry({ id: "themes", name: "Themes", installed: true, enabled: true }),
  entry({ id: "backups", name: "Backups", installed: true, enabled: false }),
];

function cardTitles(container: HTMLElement) {
  return [...container.querySelectorAll('[data-slot="card-header"] p:first-child')].map(
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

  it("renders one card per app beneath the catalog heading", async () => {
    await render(
      <MarketplaceBrowser
        marketplacePlugins={marketplace}
        onQueryChange={() => {}}
        onSelect={() => {}}
        query=""
      />,
    );

    expect(cardTitles(container)).toEqual(["Storage Report", "Themes", "Backups"]);
    expect(container.querySelector("h1")?.textContent).toBe("Marketplace");
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

    const reload = container.querySelector('button[aria-label="Reload extensions"]');
    expect(reload).not.toBeNull();
    expect(reload?.textContent).toBe("");
  });

  it("opens the detail dialog only for the selected extension", async () => {
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

  it("reports the selected extension when a card is opened", async () => {
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

  it("treats Extensions as a Marketplace category", async () => {
    const catalog = [
      entry({ id: "builtin:journal", kind: "builtin", name: "Journal" }),
      entry({ id: "storage-report", kind: "extension", name: "Storage Report" }),
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

    const filter = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Filter by app type: All"]',
    );
    await act(async () => {
      filter?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    });
    const menuItems = [...document.body.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
    expect(document.body.textContent).not.toContain("App type");
    expect(
      menuItems.find((item) => item.textContent === "All")?.querySelector(".lucide-check"),
    ).not.toBeNull();
    const extensions = menuItems.find((item) => item.textContent === "Extensions");
    await act(async () => extensions?.click());
    expect(cardTitles(container)).toEqual(["Storage Report"]);
    const fallbackIcon = container.querySelector<HTMLElement>(
      '[data-plugin-icon="storage_report"]',
    );
    expect(fallbackIcon?.className.split(/\s+/)).toContain("text-cream-bright");
    expect(fallbackIcon?.style.backgroundColor).toBe("");
    expect(fallbackIcon?.style.color).toBe("");
  });
});
