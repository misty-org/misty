import type { PluginBrowserEntry, PluginBrowserTab } from "./types";

export function pluginStatus(plugin: PluginBrowserEntry) {
  if (!plugin.installed) {
    return "available";
  }
  return plugin.enabled ? "installed" : "disabled";
}

export function statusBadgeVariant(plugin: PluginBrowserEntry) {
  return plugin.installed && plugin.enabled ? ("secondary" as const) : ("outline" as const);
}

export function actionLabel(plugin: PluginBrowserEntry) {
  if (!plugin.installed) {
    return "Install";
  }
  return plugin.enabled ? "Open" : "Enable";
}

export function filterPlugins(plugins: PluginBrowserEntry[], query: string, tab: PluginBrowserTab) {
  const normalized = query.trim().toLowerCase();
  return plugins.filter((plugin) => {
    if (tab === "installed" && !plugin.installed) {
      return false;
    }
    if (!normalized) {
      return true;
    }
    return [
      plugin.name,
      plugin.author,
      plugin.overview,
      plugin.id,
      plugin.version,
      ...plugin.capabilities,
      ...plugin.permissions,
      ...plugin.whereItAppears,
      ...plugin.gettingStarted,
      ...plugin.changelog,
      ...plugin.includedTools.map((tool) => `${tool.name} ${tool.version}`),
    ]
      .join("\n")
      .toLowerCase()
      .includes(normalized);
  });
}
