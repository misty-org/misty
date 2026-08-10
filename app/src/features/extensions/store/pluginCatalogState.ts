import { hasTauriInternals } from "@/shared/platform/tauri";
import { invoke } from "@tauri-apps/api/core";
import type {
  LocalPluginRecord,
  PluginCatalogEntry,
  PluginCatalogIndexEntry,
  PluginEntry,
} from "../model/types";
import {
  readCatalogEntries,
  readCatalogIndex,
  REMOVED_PLUGIN_IDS,
  toPluginEntry,
  type PluginsStore,
} from "./pluginCatalog";
export function mergeCatalogPlugins(
  catalogEntries: PluginCatalogEntry[],
  localPlugins: LocalPluginRecord[],
  platform: string,
) {
  const localById = new Map(localPlugins.map((plugin) => [plugin.id, plugin]));
  return catalogEntries
    .filter((catalog) => !REMOVED_PLUGIN_IDS.has(catalog.id))
    .map((catalog) => toPluginEntry(catalog, localById.get(catalog.id), platform));
}

export function filterCatalogEntries(entries: PluginCatalogEntry[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return entries;
  }

  return entries.filter((plugin) =>
    [
      plugin.name,
      plugin.author,
      plugin.overview,
      plugin.id,
      plugin.version,
      ...plugin.capabilities,
      ...plugin.permissions,
      ...plugin.where_it_appears,
      ...plugin.getting_started,
      ...plugin.changelog,
      ...plugin.included_tools.map((tool) => `${tool.name} ${tool.version}`),
    ]
      .join("\n")
      .toLowerCase()
      .includes(normalized),
  );
}

export function chooseSelectedPluginId(
  previousSelectedId: string,
  marketplacePlugins: PluginEntry[],
  installedPlugins: PluginEntry[],
) {
  // Selection drives the detail dialog, so it stays empty unless the reader
  // picked an extension. Falling back to the first entry would open it on load.
  const all = [...marketplacePlugins, ...installedPlugins];
  return all.find((plugin) => plugin.id === previousSelectedId)?.id ?? "";
}

export async function scanLocalPlugins() {
  if (!hasTauriInternals()) {
    return [];
  }
  const plugins = await invoke<LocalPluginRecord[]>("scan_local_plugins");
  return dedupeLocalPlugins(plugins.filter((plugin) => !REMOVED_PLUGIN_IDS.has(plugin.id)));
}

export function localPluginPriority(plugin: LocalPluginRecord) {
  return plugin.root === "private" ? 2 : 1;
}

export function dedupeLocalPlugins(plugins: LocalPluginRecord[]) {
  const deduped = new Map<string, LocalPluginRecord>();

  for (const plugin of plugins) {
    const existing = deduped.get(plugin.id);
    if (!existing) {
      deduped.set(plugin.id, plugin);
      continue;
    }

    if (localPluginPriority(plugin) > localPluginPriority(existing)) {
      deduped.set(plugin.id, plugin);
      continue;
    }

    if (localPluginPriority(plugin) === localPluginPriority(existing)) {
      const existingScore =
        (existing.enabled ? 1 : 0) +
        (existing.overview.trim().length > 0 ? 1 : 0) +
        existing.capabilities.length +
        existing.links.length;
      const pluginScore =
        (plugin.enabled ? 1 : 0) +
        (plugin.overview.trim().length > 0 ? 1 : 0) +
        plugin.capabilities.length +
        plugin.links.length;

      if (pluginScore > existingScore) {
        deduped.set(plugin.id, plugin);
      }
    }
  }

  return [...deduped.values()];
}

export function buildPluginViews(
  catalogEntries: PluginCatalogEntry[],
  query: string,
  localPlugins: LocalPluginRecord[],
  platform: string,
) {
  const filteredCatalogEntries = filterCatalogEntries(catalogEntries, query);
  const marketplacePlugins = mergeCatalogPlugins(filteredCatalogEntries, localPlugins, platform);

  const installedCatalogEntries = catalogEntries.filter((plugin) =>
    localPlugins.some((local) => local.id === plugin.id),
  );
  const installedPlugins = mergeCatalogPlugins(installedCatalogEntries, localPlugins, platform);

  return { marketplacePlugins, installedPlugins };
}

export async function rebuildCatalogState(
  set: (partial: Partial<PluginsStore> | ((state: PluginsStore) => Partial<PluginsStore>)) => void,
  get: () => PluginsStore,
  next?: {
    platform?: string;
    query?: string;
    localPlugins?: LocalPluginRecord[];
    catalogIndex?: PluginCatalogIndexEntry[];
    catalogEntries?: PluginCatalogEntry[];
    loading?: boolean;
  },
) {
  const state = get();
  const platform = next?.platform ?? state.platform;
  const query = next?.query ?? state.query;
  const catalogIndex = next?.catalogIndex ?? state.catalogIndex;
  const catalogEntries = (next?.catalogEntries ?? state.catalogEntries).filter(
    (plugin) => !REMOVED_PLUGIN_IDS.has(plugin.id),
  );
  const localPlugins = (next?.localPlugins ?? state.localPlugins).filter(
    (plugin) => !REMOVED_PLUGIN_IDS.has(plugin.id),
  );
  const { marketplacePlugins, installedPlugins } = buildPluginViews(
    catalogEntries,
    query,
    localPlugins,
    platform,
  );

  set({
    loading: next?.loading ?? false,
    platform,
    query,
    catalogIndex,
    catalogEntries,
    localPlugins,
    lastLoadedAt: next?.catalogEntries ? Date.now() : state.lastLoadedAt,
    marketplacePlugins,
    installedPlugins,
    selectedPluginId: chooseSelectedPluginId(
      state.selectedPluginId,
      marketplacePlugins,
      installedPlugins,
    ),
  });
}

export async function refreshPlugins(
  set: (partial: Partial<PluginsStore> | ((state: PluginsStore) => Partial<PluginsStore>)) => void,
  get: () => PluginsStore,
  platform: string,
) {
  set({
    loading: true,
    error: "",
    notice: "",
    platform,
  });

  const localPlugins = await scanLocalPlugins();

  try {
    const catalogIndex = await readCatalogIndex();
    const catalogEntries = await readCatalogEntries(catalogIndex);
    await rebuildCatalogState(set, get, {
      platform,
      query: "",
      localPlugins,
      catalogIndex,
      catalogEntries,
      loading: false,
    });
  } catch (error) {
    set({
      loading: false,
      platform,
      catalogIndex: [],
      catalogEntries: [],
      marketplacePlugins: [],
      installedPlugins: [],
      localPlugins,
      selectedPluginId: "",
      error: String(error),
    });
  }
}
