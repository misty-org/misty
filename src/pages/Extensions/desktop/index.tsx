import { useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { PluginBrowser } from "../components/PluginBrowser";
import type { PluginBrowserEntry } from "../components/types";
import { currentPluginPlatform, usePluginsStore } from "../../../stores/usePluginsStore";
import { useSetupStore } from "../../../stores/useSetupStore";
import type { PluginEntry } from "../../../models/plugins";

function toBrowserEntry(plugin: PluginEntry): PluginBrowserEntry {
  return {
    id: plugin.id,
    name: plugin.name,
    version: plugin.version,
    author: plugin.author,
    overview: plugin.overview,
    installed: plugin.installed,
    enabled: plugin.enabled,
    verified: plugin.verified,
    logoSrc: plugin.logo_path,
  };
}

export default function PluginsPage() {
  const [searchParams] = useSearchParams();
  const routePluginId = searchParams.get("plugin")?.trim() ?? "";
  const pluginPlatform = useSetupStore((state) =>
    state.status ? currentPluginPlatform(state.status.os, state.status.arch) : "",
  );
  const {
    actionPluginId,
    error,
    installedPlugins,
    loading,
    loadPlugins,
    marketplacePlugins,
    notice,
    query,
    selectPlugin,
    selectedPluginId,
    setPluginEnabled,
    setQuery,
    uninstallPlugin,
    installPlugin,
  } = usePluginsStore(
    useShallow((state) => ({
      actionPluginId: state.actionPluginId,
      error: state.error,
      installedPlugins: state.installedPlugins,
      loading: state.loading,
      loadPlugins: state.loadPlugins,
      marketplacePlugins: state.marketplacePlugins,
      notice: state.notice,
      query: state.query,
      selectPlugin: state.selectPlugin,
      selectedPluginId: state.selectedPluginId,
      setPluginEnabled: state.setPluginEnabled,
      setQuery: state.setQuery,
      uninstallPlugin: state.uninstallPlugin,
      installPlugin: state.installPlugin,
    })),
  );

  useEffect(() => {
    if (!pluginPlatform) {
      return;
    }

    void loadPlugins(pluginPlatform);
  }, [loadPlugins, pluginPlatform]);

  const browserMarketplacePlugins = useMemo(
    () => marketplacePlugins.map(toBrowserEntry),
    [marketplacePlugins],
  );
  const browserInstalledPlugins = useMemo(
    () => installedPlugins.map(toBrowserEntry),
    [installedPlugins],
  );
  const routePluginAvailable = useMemo(
    () => Boolean(routePluginId) && [...marketplacePlugins, ...installedPlugins].some((plugin) => plugin.id === routePluginId),
    [installedPlugins, marketplacePlugins, routePluginId],
  );

  useEffect(() => {
    if (routePluginAvailable && routePluginId !== selectedPluginId) {
      selectPlugin(routePluginId);
    }
  }, [routePluginAvailable, routePluginId, selectPlugin, selectedPluginId]);

  return (
    <PluginBrowser
      error={error}
      installedPlugins={browserInstalledPlugins}
      loading={loading || actionPluginId.length > 0}
      marketplacePlugins={browserMarketplacePlugins}
      notice={notice}
      onInstall={(plugin) => {
        const match = marketplacePlugins.find((entry) => entry.id === plugin.id)
          ?? installedPlugins.find((entry) => entry.id === plugin.id);
        if (match) {
          void installPlugin(match);
        }
      }}
      onQueryChange={(value) => {
        setQuery(value);
      }}
      onRefresh={() => {
        if (pluginPlatform) {
          void loadPlugins(pluginPlatform, true);
        }
      }}
      onSelect={selectPlugin}
      onToggle={(plugin, enabled) => {
        const match = marketplacePlugins.find((entry) => entry.id === plugin.id)
          ?? installedPlugins.find((entry) => entry.id === plugin.id);
        if (match) {
          void setPluginEnabled(match, enabled);
        }
      }}
      onUninstall={(plugin) => {
        const match = installedPlugins.find((entry) => entry.id === plugin.id)
          ?? marketplacePlugins.find((entry) => entry.id === plugin.id);
        if (match) {
          void uninstallPlugin(match);
        }
      }}
      query={query}
      selectedPluginId={selectedPluginId}
      title="Extensions"
    />
  );
}
