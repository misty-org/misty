import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { hasTauriInternals, safeTauriAssetUrl } from "../shared/tauri";
import type {
  LocalPluginRecord,
  PluginArtifact,
  PluginCatalogEntry,
  PluginCatalogIndexEntry,
  PluginEntry,
  PluginRootKind,
} from "../models/plugins";
import { publishPluginCatalogChanged } from "../plugins/pluginEvents";

const DEFAULT_CATALOG_BASE_URL =
  "https://raw.githubusercontent.com/misty-org/misty-extensions/main/catalog";
const catalogBaseUrl = normalizeCatalogBaseUrl(
  import.meta.env.VITE_EXTENSIONS_URL
    ?? import.meta.env.VITE_EXTENSION_CATALOG_BASE_URL
    ?? import.meta.env.VITE_PLUGIN_CATALOG_BASE_URL,
);
const catalogSourceArchiveUrl = githubSourceArchiveUrlForCatalog(catalogBaseUrl);

function normalizeCatalogBaseUrl(value: string | undefined): string {
  const configured = value?.trim();
  if (!configured) return DEFAULT_CATALOG_BASE_URL;

  const repoSlugMatch = configured.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (repoSlugMatch) {
    const [, owner, repo] = repoSlugMatch;
    return `https://raw.githubusercontent.com/${owner}/${repo}/main/catalog`;
  }

  const githubRepoMatch = configured.match(
    /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\/)?$/,
  );
  if (githubRepoMatch) {
    const [, owner, repo] = githubRepoMatch;
    return `https://raw.githubusercontent.com/${owner}/${repo}/main/catalog`;
  }

  const githubTreeMatch = configured.match(
    /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)(?:\/(.+))?$/,
  );
  if (githubTreeMatch) {
    const [, owner, repo, branch, path] = githubTreeMatch;
    return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path?.replace(/\/$/, "") || "catalog"}`;
  }

  return configured.replace(/\/$/, "");
}

function githubSourceArchiveUrlForCatalog(baseUrl: string): string | null {
  const rawMatch = baseUrl.match(
    /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)(?:\/.*)?$/,
  );
  if (rawMatch) {
    const [, owner, repo, branch] = rawMatch;
    return `https://github.com/${owner}/${repo}/archive/refs/heads/${branch}.zip`;
  }

  const githubMatch = baseUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)(?:\/.*)?$/);
  if (githubMatch) {
    const [, owner, repo] = githubMatch;
    return `https://github.com/${owner}/${repo}/archive/refs/heads/main.zip`;
  }

  return null;
}

const REMOVED_PLUGIN_IDS = new Set(["git", "preview-panel", "preview_panel", "vault"]);

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
  loadPlugins: (platform: string, force?: boolean) => Promise<void>;
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
  included_tools?: Array<string | { name?: string; version?: string }>;
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
  return (parseCatalogJson(await response.text()) as PluginCatalogIndexEntry[]).filter(
    (entry) => !REMOVED_PLUGIN_IDS.has(entry.id),
  );
}

function parseCatalogJson(text: string): unknown {
  return JSON.parse(text.replace(/,\s*([}\]])/g, "$1"));
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
      const raw = await readCatalogEntry(entry);
      return normalizeCatalogEntry(entry, raw);
    }),
  );

  return responses;
}

async function readCatalogEntry(entry: PluginCatalogIndexEntry): Promise<RawPluginCatalogFile> {
  const urls = [
    catalogEntryUrl(entry),
    resolveUrl(`extensions/${entry.id}.json`),
  ];
  let lastStatus = "";
  for (const url of Array.from(new Set(urls))) {
    const response = await fetch(url);
    if (response.ok) {
      return parseCatalogJson(await response.text()) as RawPluginCatalogFile;
    }
    lastStatus = `${response.status} from ${url}`;
  }
  throw new Error(`Could not load extension catalog for ${entry.id}: ${lastStatus}`);
}

function sourceArchiveArtifact(platform: string): PluginArtifact | null {
  if (!catalogSourceArchiveUrl) return null;
  return {
    platform,
    url: catalogSourceArchiveUrl,
  };
}

function normalizeCatalogEntry(
  indexEntry: PluginCatalogIndexEntry,
  raw: RawPluginCatalogFile,
): PluginCatalogEntry {
  const id = raw.manifest?.id ?? raw.id ?? indexEntry.id;

  return {
    id,
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
    included_tools: (raw.included_tools ?? []).map((tool) => typeof tool === "string" ? { name: tool, version: "" } : { name: tool.name ?? "Tool", version: tool.version ?? "" }),
    links: raw.links ?? [],
    actions: raw.actions ?? [],
    verified: raw.verified ?? false,
    launcher: {
      views: raw.launcher?.views ?? [],
      show_in_launcher: raw.launcher?.show_in_launcher ?? false,
      requires_selected_file: raw.launcher?.requires_selected_file ?? false,
      open_mode: raw.launcher?.open_mode ?? "popup",
    },
    install: {
      root: raw.install?.root === "private" ? "private" : "public",
      artifacts:
        raw.install?.artifacts ??
        (raw.install?.platforms ?? [])
          .map(sourceArchiveArtifact)
          .filter((artifact): artifact is PluginArtifact => artifact != null),
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

async function resolveArtifactChecksum(plugin: PluginEntry): Promise<string | undefined> {
  if (plugin.artifact?.sha256) return plugin.artifact.sha256;
  if (!plugin.verified || !plugin.artifact?.url) return undefined;
  const response = await fetch(`${plugin.artifact.url}.sha256`);
  if (!response.ok) throw new Error(`The published checksum for ${plugin.name} is unavailable.`);
  const checksum = (await response.text()).trim().split(/\s+/)[0]?.toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(checksum)) throw new Error(`The published checksum for ${plugin.name} is invalid.`);
  return checksum;
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
    included_tools: prefer(local?.included_tools, catalog.included_tools),
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
  return catalogEntries.filter((catalog) => !REMOVED_PLUGIN_IDS.has(catalog.id)).map((catalog) =>
    toPluginEntry(catalog, localById.get(catalog.id), platform),
  );
}

function filterCatalogEntries(entries: PluginCatalogEntry[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return entries;
  }

  return entries.filter((plugin) =>
    [plugin.name, plugin.author, plugin.overview, plugin.id, plugin.version, ...plugin.capabilities, ...plugin.permissions, ...plugin.where_it_appears, ...plugin.getting_started, ...plugin.changelog, ...plugin.included_tools.map((tool) => `${tool.name} ${tool.version}`)]
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
  return dedupeLocalPlugins(plugins.filter((plugin) => !REMOVED_PLUGIN_IDS.has(plugin.id)));
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
  const catalogEntries = (next?.catalogEntries ?? state.catalogEntries).filter((plugin) => !REMOVED_PLUGIN_IDS.has(plugin.id));
  const localPlugins = (next?.localPlugins ?? state.localPlugins).filter((plugin) => !REMOVED_PLUGIN_IDS.has(plugin.id));
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
  loadPlugins: async (platform, force = false) => {
    const state = get();
    const hasFreshCatalog =
      state.platform === platform &&
      state.catalogEntries.length > 0 &&
      Date.now() - state.lastLoadedAt < PLUGIN_CATALOG_CACHE_TTL_MS;

    if ((!force && hasFreshCatalog) || state.loading) {
      return;
    }

    await refreshPlugins(set, get, platform);
  },
  installPlugin: async (plugin) => {
    if (!hasTauriInternals()) {
      set({ error: "Installing extensions is only available in the Misty app." });
      return;
    }
    if (!plugin.artifact?.url) {
      set({ error: `No install bundle is configured for ${plugin.name}.` });
      return;
    }
    set({ actionPluginId: plugin.id, error: "", notice: "" });
    try {
      const sha256 = await resolveArtifactChecksum(plugin);
      const result = await invoke<string>("install_plugin_bundle", {
        pluginId: plugin.id,
        root: plugin.root,
        url: plugin.artifact.url,
        platform: plugin.artifact.platform,
        sha256,
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
      set({ error: "Managing installed extensions is only available in the Misty app." });
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
      set({ error: "Uninstalling extensions is only available in the Misty app." });
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
