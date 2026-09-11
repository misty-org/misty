import { compareDiscoverItems } from "./discoverSort";
import type { DiscoverSort, DiscoverExtraFilters } from "./DiscoverViewControls";
import { useEffect, useState } from "react";
import { useSetupStore } from "@/features/installer";
import { currentPluginPlatform, usePluginsStore, type PluginEntry } from "@/features/extensions";
import { MarketplaceDetailDialog } from "./MarketplaceDetailDialog";
import { MarketplaceCatalogIcon } from "./MarketplaceCatalogIcon";
import type { MarketplaceEntry } from "./types";

function entry(plugin: PluginEntry): MarketplaceEntry {
  return {
    ...plugin,
    kind: "extension",
    logoSrc: plugin.logo_path,
    catalogVersion: plugin.catalog_version,
    updateAvailable: plugin.update_available,
    whereItAppears: plugin.where_it_appears,
    gettingStarted: plugin.getting_started,
    includedTools: plugin.included_tools,
    placement: {
      views: plugin.launcher.views,
      openMode: "tab",
      requiresSelection: plugin.launcher.requires_selected_file,
    },
  };
}

export function DiscoverExtensions({
  query,
  refreshKey,
  sort,
  extra,
  onClearFilters,
}: {
  query: string;
  refreshKey: number;
  sort: DiscoverSort;
  extra: DiscoverExtraFilters;
  onClearFilters: () => void;
}) {
  const platform = useSetupStore((state) =>
    state.status ? currentPluginPlatform(state.status.os, state.status.arch) : "",
  );
  const catalog = usePluginsStore((state) => state.marketplacePlugins);
  const installed = usePluginsStore((state) => state.installedPlugins);
  const loading = usePluginsStore((state) => state.loading);
  const action = usePluginsStore((state) => state.actionPluginId);
  const error = usePluginsStore((state) => state.error);
  const load = usePluginsStore((state) => state.loadPlugins);
  const [selectedId, select] = useState("");
  useEffect(() => {
    if (platform) void load(platform, refreshKey > 0);
  }, [platform, load, refreshKey]);
  const plugins = [
    ...new Map([...catalog, ...installed].map((plugin) => [plugin.id, plugin])).values(),
  ];
  const needle = query.trim().toLowerCase();
  const visible = plugins.filter(
    (plugin) =>
      `${plugin.name} ${plugin.author} ${plugin.overview}`.toLowerCase().includes(needle) &&
      (extra.download === "all" ||
        (extra.download === "downloaded" ? plugin.installed : !plugin.installed)) &&
      (!extra.updates || (plugin.installed && plugin.update_available)),
  );
  if (sort !== "catalog")
    visible.sort((a, b) =>
      compareDiscoverItems(
        { name: a.name, publisher: a.author },
        { name: b.name, publisher: b.author },
        sort,
      ),
    );
  const filtered = Boolean(needle) || extra.download !== "all" || extra.updates;
  const selected = plugins.find((plugin) => plugin.id === selectedId);
  return (
    <>
      {error && (
        <div className="discover-error" role="alert">
          <p>{error}</p>
          <button disabled={loading || !platform} onClick={() => void load(platform, true)}>
            Try again
          </button>
        </div>
      )}
      {loading && !plugins.length ? (
        <div className="discover-empty" role="status">
          Loading extensions…
        </div>
      ) : visible.length ? (
        <ul className="discover-app-list" aria-label="Extensions catalog">
          {visible.map((plugin) => (
            <li key={plugin.id} className="discover-app-row">
              <button
                className="discover-app-details-button"
                aria-label={`View ${plugin.name} details`}
                onClick={() => select(plugin.id)}
              >
                <MarketplaceCatalogIcon
                  className="size-10 shrink-0"
                  pluginId={plugin.id}
                  pluginName={plugin.name}
                  logoSrc={plugin.logo_path}
                />
                <span className="discover-app-copy">
                  <span className="discover-app-name">{plugin.name}</span>
                  <span className="discover-app-description">{plugin.overview}</span>
                </span>
              </button>
              <div className="discover-action-group">
                <button
                  className={`discover-action ${plugin.installed ? "" : "discover-action-primary"}`}
                  disabled={!!action}
                  onClick={() => select(plugin.id)}
                  aria-label={`${plugin.installed ? "Manage" : "Get"} ${plugin.name}`}
                >
                  {action === plugin.id ? "Working…" : plugin.installed ? "Manage" : "Get"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        !error && (
          <div className="discover-empty">
            <h2>{filtered ? "No extensions found" : "No extensions available yet"}</h2>
            <p>
              {!platform
                ? "Open Misty on desktop to browse extensions."
                : filtered
                  ? "Try another search or adjust your filters."
                  : "Refresh to check the extension catalog again."}
            </p>
            {filtered && (
              <button className="discover-action" onClick={onClearFilters}>
                Clear filters
              </button>
            )}
          </div>
        )
      )}
      <MarketplaceDetailDialog
        plugin={selected ? entry(selected) : undefined}
        busy={loading || !!action}
        onClose={() => select("")}
        onInstall={() => {
          if (selected) void usePluginsStore.getState().installPlugin(selected);
        }}
        onToggle={(_, enabled) => {
          if (selected) void usePluginsStore.getState().setPluginEnabled(selected, enabled);
        }}
        onUninstall={() => {
          if (selected) void usePluginsStore.getState().uninstallPlugin(selected);
        }}
      />
    </>
  );
}
