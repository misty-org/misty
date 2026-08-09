import { httpRequest } from "@/services/http";
import { hasTauriInternals, safeTauriAssetUrl } from "@/shared/platform/tauri";
import type {
  LocalPluginRecord,
  PluginArtifact,
  PluginCatalogEntry,
  PluginCatalogIndexEntry,
  PluginEntry,
  PluginRootKind,
} from "../model/types";

export const DEFAULT_CATALOG_BASE_URL =
  "https://raw.githubusercontent.com/misty-org/misty-extensions/main/catalog";
const catalogBaseUrl = normalizeCatalogBaseUrl(
  import.meta.env.VITE_EXTENSIONS_URL ??
    import.meta.env.VITE_EXTENSION_CATALOG_BASE_URL ??
    import.meta.env.VITE_PLUGIN_CATALOG_BASE_URL,
);
const catalogSourceArchiveUrl = githubSourceArchiveUrlForCatalog(catalogBaseUrl);

export function normalizeCatalogBaseUrl(value: string | undefined): string {
  const configured = value?.trim();
  if (!configured) return DEFAULT_CATALOG_BASE_URL;

  const repoSlugMatch = configured.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (repoSlugMatch) {
    const [, owner, repo] = repoSlugMatch;
    return `https://raw.githubusercontent.com/${owner}/${repo}/main/catalog`;
  }

  const githubRepoMatch = configured.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\/)?$/);
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

export function githubSourceArchiveUrlForCatalog(baseUrl: string): string | null {
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

export const REMOVED_PLUGIN_IDS = new Set(["git", "preview-panel", "preview_panel", "vault"]);

export type PluginsStore = {
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

export const PLUGIN_CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;

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

export async function readCatalogIndex() {
  const response = await httpRequest(`${catalogBaseUrl}/index.json`);
  if (!response.ok) {
    throw new Error(`Could not load extension catalog index.json: ${response.status}`);
  }
  return (parseCatalogJson(await response.text()) as PluginCatalogIndexEntry[]).filter(
    (entry) => !REMOVED_PLUGIN_IDS.has(entry.id),
  );
}

export function parseCatalogJson(text: string): unknown {
  return JSON.parse(text.replace(/,\s*([}\]])/g, "$1"));
}

export function resolveUrl(path: string) {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  return new URL(path.replace(/^\/+/, ""), `${catalogBaseUrl}/`).toString();
}

export function catalogEntryUrl(entry: PluginCatalogIndexEntry) {
  if (entry.url.endsWith(".json")) {
    return resolveUrl(entry.url);
  }

  const githubRepoMatch = entry.url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\/)?$/);
  if (githubRepoMatch) {
    const [, owner, repo] = githubRepoMatch;
    return `https://raw.githubusercontent.com/${owner}/${repo}/main/catalog/extensions/${entry.id}.json`;
  }

  return resolveUrl(entry.url);
}

export async function readCatalogEntries(index: PluginCatalogIndexEntry[]) {
  const responses = await Promise.all(
    index.map(async (entry) => {
      const raw = await readCatalogEntry(entry);
      return normalizeCatalogEntry(entry, raw);
    }),
  );

  return responses;
}

export async function readCatalogEntry(
  entry: PluginCatalogIndexEntry,
): Promise<RawPluginCatalogFile> {
  const urls = [catalogEntryUrl(entry), resolveUrl(`extensions/${entry.id}.json`)];
  let lastStatus = "";
  for (const url of Array.from(new Set(urls))) {
    const response = await httpRequest(url);
    if (response.ok) {
      return parseCatalogJson(await response.text()) as RawPluginCatalogFile;
    }
    lastStatus = `${response.status} from ${url}`;
  }
  throw new Error(`Could not load extension catalog for ${entry.id}: ${lastStatus}`);
}

export function sourceArchiveArtifact(platform: string): PluginArtifact | null {
  if (!catalogSourceArchiveUrl) return null;
  return {
    platform,
    url: catalogSourceArchiveUrl,
  };
}

export function normalizeCatalogEntry(
  indexEntry: PluginCatalogIndexEntry,
  raw: RawPluginCatalogFile,
): PluginCatalogEntry {
  const id = raw.manifest?.id ?? raw.id ?? indexEntry.id;

  return {
    id,
    name: raw.manifest?.name ?? raw.name ?? indexEntry.name,
    version: raw.manifest?.version ?? raw.version ?? "0.0.0",
    author: raw.manifest?.author ?? raw.author ?? "Misty",
    overview: raw.overview ?? raw.manifest?.description ?? "",
    logo_path: raw.logo_path,
    status: raw.status ?? "available",
    capabilities: raw.capabilities ?? [],
    where_it_appears: raw.where_it_appears ?? [],
    permissions: raw.permissions ?? [],
    getting_started: raw.getting_started ?? [],
    changelog: raw.changelog ?? [],
    included_tools: (raw.included_tools ?? []).map((tool) =>
      typeof tool === "string"
        ? { name: tool, version: "" }
        : { name: tool.name ?? "Tool", version: tool.version ?? "" },
    ),
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

export function resolveCatalogAssetUrl(path: string | undefined) {
  if (!path) {
    return undefined;
  }
  return resolveUrl(path);
}

export function resolveLocalAssetUrl(path: string | undefined) {
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

export function defaultArtifact(
  catalog: PluginCatalogEntry,
  platform: string,
): PluginArtifact | undefined {
  return catalog.install.artifacts.find((artifact) => artifact.platform === platform);
}

export async function resolveArtifactChecksum(plugin: PluginEntry): Promise<string | undefined> {
  if (plugin.artifact?.sha256) return plugin.artifact.sha256;
  if (!plugin.verified || !plugin.artifact?.url) return undefined;
  const response = await httpRequest(`${plugin.artifact.url}.sha256`);
  if (!response.ok) throw new Error(`The published checksum for ${plugin.name} is unavailable.`);
  const checksum = (await response.text()).trim().split(/\s+/)[0]?.toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(checksum))
    throw new Error(`The published checksum for ${plugin.name} is invalid.`);
  return checksum;
}

export function prefer<T>(primary: T | undefined, fallback: T): T {
  if (typeof primary === "string") {
    return (primary.trim().length > 0 ? primary : fallback) as T;
  }
  if (Array.isArray(primary)) {
    return (primary.length > 0 ? primary : fallback) as T;
  }
  return primary ?? fallback;
}

export function toPluginEntry(
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
    logo_path: resolveLocalAssetUrl(local?.logo_path) ?? resolveCatalogAssetUrl(catalog.logo_path),
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
      show_in_launcher: local?.launcher.show_in_launcher ?? catalog.launcher.show_in_launcher,
      requires_selected_file:
        local?.launcher.requires_selected_file ?? catalog.launcher.requires_selected_file,
      open_mode: prefer(local?.launcher.open_mode, catalog.launcher.open_mode),
    },
    artifact: defaultArtifact(catalog, platform),
  };
}
