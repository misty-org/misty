import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PluginBrowser } from "./components/PluginBrowser";
import type { PluginBrowserEntry } from "./components/types";

function entry(overrides: Partial<PluginBrowserEntry> & { id: string }): PluginBrowserEntry {
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

describe("PluginBrowser", () => {
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

  it("renders one card per extension and no page heading", async () => {
    await render(
      <PluginBrowser
        marketplacePlugins={marketplace}
        onQueryChange={() => {}}
        onSelect={() => {}}
        query=""
      />,
    );

    expect(cardTitles(container)).toEqual(["Storage Report", "Themes", "Backups"]);
    expect(container.querySelector("h1")).toBeNull();
  });

  it("keeps the manual reload fallback quiet and icon-only", async () => {
    await render(
      <PluginBrowser
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
      <PluginBrowser
        marketplacePlugins={marketplace}
        onQueryChange={() => {}}
        onSelect={() => {}}
        query=""
      />,
    );
    expect(document.querySelector('[data-slot="dialog-content"]')).toBeNull();

    await render(
      <PluginBrowser
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
      <PluginBrowser
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
      <PluginBrowser
        installedPlugins={marketplace.filter((plugin) => plugin.installed)}
        marketplacePlugins={marketplace}
        onQueryChange={() => {}}
        onSelect={() => {}}
        query="backups"
      />,
    );

    expect(cardTitles(container)).toEqual(["Backups"]);
  });
});
