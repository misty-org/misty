import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { hasTauriInternals, safeTauriAssetUrl } from "../../../shared/tauri";
import type {
  LocalPluginRecord,
  PluginArtifact,
  PluginCatalogEntry,
  PluginCatalogIndexEntry,
  PluginEntry,
  PluginRootKind,
} from "../types/plugins";
import { publishPluginCatalogChanged } from "../../plugins/pluginEvents";

const DEFAULT_CATALOG_BASE_URL =
  "https://raw.githubusercontent.com/misty-org/misty-extensions/main/catalog";
const catalogBaseUrl =
  import.meta.env.VITE_EXTENSION_CATALOG_BASE_URL
  ?? import.meta.env.VITE_PLUGIN_CATALOG_BASE_URL
  ?? DEFAULT_CATALOG_BASE_URL;

type PluginsStore = {
  loading: boolean;
  actionPluginId: string;
  error: string;
  notice: string;
  marketplacePlugins: PluginEntry[];
  installedPlugins: PluginEntry[];
  selectedPluginId: string;
  query: string;
  catalogIndex: PluginCatalogIndexEntry[];
  catalogEntries: PluginCatalogEntry[];
  localPlugins: LocalPluginRecord[];
  lastLoadedAt: number;
  platform: string;
  loadPlugins: (platform: string) => Promise<void>;
  installPlugin: (plugin: PluginEntry) => Promise<void>;
  selectPlugin: (pluginId: string) => void;
  setPluginEnabled: (plugin: PluginEntry, enabled: boolean) => Promise<void>;
  setQuery: (query: string) => void;
  uninstallPlugin: (plugin: PluginEntry) => Promise<void>;
};

const PLUGIN_CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;

type RawPluginCatalogFile = {
  id?: string;
  name?: string;
  version?: string;
  author?: string;
  overview?: string;
  logo_path?: string;
  status?: string;
  capabilities?: string[];
  where_it_appears?: string[];
  permissions?: string[];
  getting_started?: string[];
  changelog?: string[];
  links?: PluginCatalogEntry["links"];
  actions?: PluginCatalogEntry["actions"];
  verified?: boolean;
  launcher?: Partial<PluginCatalogEntry["launcher"]>;
  manifest?: {
    id?: string;
    name?: string;
    version?: string;
    author?: string;
    description?: string;
  };
  install?: {
    root?: PluginRootKind;
    artifacts?: PluginArtifact[];
    artifact_base_name?: string;
    platforms?: string[];
  };
};

async function readCatalogIndex() {
  const response = await fetch(`${catalogBaseUrl}/index.json`);
  if (!response.ok) {
    throw new Error(`Could not load extension catalog index.json: ${response.status}`);
  }
  return (await response.json()) as PluginCatalogIndexEntry[];
}

function resolveUrl(path: string) {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  return new URL(path.replace(/^\/+/, ""), `${catalogBaseUrl}/`).toString();
}

function catalogEntryUrl(entry: PluginCatalogIndexEntry) {
  if (entry.url.endsWith(".json")) {
    return resolveUrl(entry.url);
  }

  const githubRepoMatch = entry.url.match(
    /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\/)?$/,
  );
  if (githubRepoMatch) {
    const [, owner, repo] = githubRepoMatch;
    return `https://raw.githubusercontent.com/${owner}/${repo}/main/catalog/extensions/${entry.id}.json`;
  }

  return resolveUrl(entry.url);
}

async function readCatalogEntries(index: PluginCatalogIndexEntry[]) {
  const responses = await Promise.all(
    index.map(async (entry) => {
      const response = await fetch(catalogEntryUrl(entry));
      if (!response.ok) {
        throw new Error(`Could not load extension catalog for ${entry.id}: ${response.status}`);
      }
      const raw = (await response.json()) as RawPluginCatalogFile;
      return normalizeCatalogEntry(entry, raw);
    }),
  );

  return responses;
}

function artifactUrl(baseName: string, platform: string) {
  return `https://github.com/misty-org/misty-hub/releases/download/plugins/${baseName}-${platform}.zip`;
}

function normalizeCatalogEntry(
  indexEntry: PluginCatalogIndexEntry,
  raw: RawPluginCatalogFile,
): PluginCatalogEntry {
  const artifactBaseName =
    raw.install?.artifact_base_name ?? indexEntry.id.replace(/_/g, "-");

  return {
    id: raw.manifest?.id ?? raw.id ?? indexEntry.id,
    name: raw.manifest?.name ?? raw.name ?? indexEntry.name,
    version: raw.manifest?.version ?? raw.version ?? "0.0.0",
    author: raw.manifest?.author ?? raw.author ?? "Misty",
    overview:
      raw.overview ??
      raw.manifest?.description ??
      "",
    logo_path: raw.logo_path,
    status: raw.status ?? "available",
    capabilities: raw.capabilities ?? [],
    where_it_appears: raw.where_it_appears ?? [],
    permissions: raw.permissions ?? [],
    getting_started: raw.getting_started ?? [],
    changelog: raw.changelog ?? [],
    links: raw.links ?? [],
    actions: raw.actions ?? [],
    verified: raw.verified ?? false,
    launcher: {
      views: raw.launcher?.views ?? [],
      show_in_launcher: raw.launcher?.show_in_launcher ?? false,
      requires_selected_file: raw.launcher?.requires_selected_file ?? false,
      open_mode: raw.launcher?.open_mode ?? "tab",
    },
    install: {
      root: raw.install?.root ?? "public",
      artifacts:
        raw.install?.artifacts ??
        (raw.install?.platforms ?? []).map((platform) => ({
          platform,
          url: artifactUrl(artifactBaseName, platform),
        })),
    },
  };
}

function resolveCatalogAssetUrl(path: string | undefined) {
  if (!path) {
    return undefined;
  }
  return resolveUrl(path);
}

function resolveLocalAssetUrl(path: string | undefined) {
  if (!path) {
    return undefined;
  }
  if (/^(https?:|asset:|file:)/i.test(path)) {
    return path;
  }
  if (hasTauriInternals()) {
    return safeTauriAssetUrl(path);
  }
  return path;
}

function defaultArtifact(catalog: PluginCatalogEntry, platform: string): PluginArtifact | undefined {
  return catalog.install.artifacts.find((artifact) => artifact.platform === platform);
}

function prefer<T>(primary: T | undefined, fallback: T): T {
  if (typeof primary === "string") {
    return (primary.trim().length > 0 ? primary : fallback) as T;
  }
  if (Array.isArray(primary)) {
    return (primary.length > 0 ? primary : fallback) as T;
  }
  return primary ?? fallback;
}

function toPluginEntry(
  catalog: PluginCatalogEntry,
  local: LocalPluginRecord | undefined,
  platform: string,
): PluginEntry {
  return {
    id: catalog.id,
    name: prefer(local?.name, catalog.name),
    version: prefer(local?.version, catalog.version),
    author: prefer(local?.author, catalog.author),
    overview: prefer(local?.overview, catalog.overview),
    status: local ? (local.enabled ? "installed" : "disabled") : catalog.status,
    root: local?.root ?? catalog.install.root,
    installed: Boolean(local?.installed),
    enabled: Boolean(local?.enabled),
    verified: local?.verified || catalog.verified,
    manifest_path: local?.manifest_path,
    plugin_dir: local?.plugin_dir,
    logo_path:
      resolveLocalAssetUrl(local?.logo_path) ?? resolveCatalogAssetUrl(catalog.logo_path),
    capabilities: prefer(local?.capabilities, catalog.capabilities),
    where_it_appears: prefer(local?.where_it_appears, catalog.where_it_appears),
    permissions: prefer(local?.permissions, catalog.permissions),
    getting_started: prefer(local?.getting_started, catalog.getting_started),
    changelog: prefer(local?.changelog, catalog.changelog),
    links: prefer(local?.links, catalog.links),
    actions: prefer(local?.actions, catalog.actions),
    launcher: {
      views: prefer(local?.launcher.views, catalog.launcher.views),
      show_in_launcher:
        local?.launcher.show_in_launcher ?? catalog.launcher.show_in_launcher,
      requires_selected_file:
        local?.launcher.requires_selected_file ??
        catalog.launcher.requires_selected_file,
      open_mode: prefer(local?.launcher.open_mode, catalog.launcher.open_mode),
    },
    artifact: defaultArtifact(catalog, platform),
  };
}

function mergeCatalogPlugins(
  catalogEntries: PluginCatalogEntry[],
  localPlugins: LocalPluginRecord[],
  platform: string,
) {
  const localById = new Map(localPlugins.map((plugin) => [plugin.id, plugin]));
  return catalogEntries.map((catalog) =>
    toPluginEntry(catalog, localById.get(catalog.id), platform),
  );
}

function filterCatalogEntries(entries: PluginCatalogEntry[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return entries;
  }

  return entries.filter((plugin) =>
    [plugin.name, plugin.author, plugin.overview, plugin.id, plugin.version]
      .join("\n")
      .toLowerCase()
      .includes(normalized),
  );
}

function chooseSelectedPluginId(
  previousSelectedId: string,
  marketplacePlugins: PluginEntry[],
  installedPlugins: PluginEntry[],
) {
  const all = [...marketplacePlugins, ...installedPlugins];
  return all.find((plugin) => plugin.id === previousSelectedId)?.id ?? all[0]?.id ?? "";
}

async function scanLocalPlugins() {
  if (!hasTauriInternals()) {
    return [];
  }
  const plugins = await invoke<LocalPluginRecord[]>("scan_local_plugins");
  return dedupeLocalPlugins(plugins);
}

function localPluginPriority(plugin: LocalPluginRecord) {
  return plugin.root === "private" ? 2 : 1;
}

function dedupeLocalPlugins(plugins: LocalPluginRecord[]) {
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

function buildPluginViews(
  catalogEntries: PluginCatalogEntry[],
  query: string,
  localPlugins: LocalPluginRecord[],
  platform: string,
) {
  const filteredCatalogEntries = filterCatalogEntries(catalogEntries, query);
  const marketplacePlugins = mergeCatalogPlugins(
    filteredCatalogEntries,
    localPlugins,
    platform,
  );

  const installedCatalogEntries = catalogEntries.filter((plugin) =>
    localPlugins.some((local) => local.id === plugin.id),
  );
  const installedPlugins = mergeCatalogPlugins(
    installedCatalogEntries,
    localPlugins,
    platform,
  );

  return { marketplacePlugins, installedPlugins };
}

async function rebuildCatalogState(
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
  const catalogEntries = next?.catalogEntries ?? state.catalogEntries;
  const localPlugins = next?.localPlugins ?? state.localPlugins;
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

async function refreshPlugins(
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

export const usePluginsStore = create<PluginsStore>((set, get) => ({
  loading: false,
  actionPluginId: "",
  error: "",
  notice: "",
  marketplacePlugins: [],
  installedPlugins: [],
  selectedPluginId: "",
  query: "",
  catalogIndex: [],
  catalogEntries: [],
  localPlugins: [],
  lastLoadedAt: 0,
  platform: "",
  loadPlugins: async (platform) => {
    const state = get();
    const hasFreshCatalog =
      state.platform === platform &&
      state.catalogEntries.length > 0 &&
      Date.now() - state.lastLoadedAt < PLUGIN_CATALOG_CACHE_TTL_MS;

    if (hasFreshCatalog || state.loading) {
      return;
    }

    await refreshPlugins(set, get, platform);
  },
  installPlugin: async (plugin) => {
    if (!hasTauriInternals()) {
      set({ error: "Installing extensions is only available in the Tauri app." });
      return;
    }
    if (!plugin.artifact?.url) {
      set({ error: `No install bundle is configured for ${plugin.name}.` });
      return;
    }
    set({ actionPluginId: plugin.id, error: "", notice: "" });
    try {
      const result = await invoke<string>("install_plugin_bundle", {
        pluginId: plugin.id,
        root: plugin.root,
        url: plugin.artifact.url,
      });
      set({ actionPluginId: "", notice: result });
      await rebuildCatalogState(set, get, {
        localPlugins: await scanLocalPlugins(),
      });
      publishPluginCatalogChanged();
    } catch (error) {
      set({ actionPluginId: "", error: String(error) });
    }
  },
  selectPlugin: (selectedPluginId) => set({ selectedPluginId }),
  setPluginEnabled: async (plugin, enabled) => {
    if (!hasTauriInternals()) {
      set({ error: "Managing installed extensions is only available in the Tauri app." });
      return;
    }
    set({ actionPluginId: plugin.id, error: "", notice: "" });
    try {
      const result = await invoke<string>("set_plugin_enabled", {
        pluginId: plugin.id,
        root: plugin.root,
        enabled,
      });
      set({ actionPluginId: "", notice: result });
      await rebuildCatalogState(set, get, {
        localPlugins: await scanLocalPlugins(),
      });
      publishPluginCatalogChanged();
    } catch (error) {
      set({ actionPluginId: "", error: String(error) });
    }
  },
  setQuery: (query) => {
    void rebuildCatalogState(set, get, { query, loading: false });
  },
  uninstallPlugin: async (plugin) => {
    if (!hasTauriInternals()) {
      set({ error: "Uninstalling extensions is only available in the Tauri app." });
      return;
    }
    set({ actionPluginId: plugin.id, error: "", notice: "" });
    try {
      const result = await invoke<string>("uninstall_plugin", {
        pluginId: plugin.id,
        root: plugin.root,
      });
      set({ actionPluginId: "", notice: result });
      await rebuildCatalogState(set, get, {
        localPlugins: await scanLocalPlugins(),
      });
      publishPluginCatalogChanged();
    } catch (error) {
      set({ actionPluginId: "", error: String(error) });
    }
  },
}));

export function currentPluginPlatform(os: string, arch: string) {
  return `${os}-${arch}`;
}

export function pluginRootLabel(root: PluginRootKind) {
  return root === "private" ? "private" : "public";
}
