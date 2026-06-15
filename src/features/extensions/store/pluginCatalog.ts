import {
  DEFAULT_CATALOG_BASE_URL,
  extensionCatalogApi,
  githubSourceArchiveUrlForCatalog,
  normalizeCatalogBaseUrl,
} from "@/api/extensions/catalog";
import { hasTauriInternals, safeTauriAssetUrl } from "@/shared/platform/tauri";
import { invoke } from "@tauri-apps/api/core";
import type {
  LocalPluginRecord,
  PluginArtifact,
  PluginCatalogEntry,
  PluginCatalogIndexEntry,
  PluginEntry,
  PluginRootKind,
} from "../model/types";

export { DEFAULT_CATALOG_BASE_URL, githubSourceArchiveUrlForCatalog, normalizeCatalogBaseUrl };

const catalogBaseUrl = extensionCatalogApi.baseUrl;
const catalogSourceArchiveUrl = extensionCatalogApi.sourceArchiveUrl;

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
  return (
    parseCatalogJson(await extensionCatalogApi.indexText()) as PluginCatalogIndexEntry[]
  ).filter((entry) => !REMOVED_PLUGIN_IDS.has(entry.id));
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
  const text = await extensionCatalogApi.firstAvailableText(
    urls,
    `extension catalog for ${entry.id}`,
  );
  return parseCatalogJson(text) as RawPluginCatalogFile;
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
      open_mode: raw.launcher?.open_mode ?? "tab",
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
  let checksum: string;
  try {
    checksum = await invoke<string>("fetch_plugin_bundle_checksum", {
      url: plugin.artifact.url,
    });
  } catch {
    throw new Error(`The published checksum for ${plugin.name} is unavailable.`);
  }
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

type ComparableVersion = {
  core: number[];
  prerelease: Array<number | string>;
};

function comparableVersion(value: string): ComparableVersion | null {
  const match = value
    .trim()
    .match(
      /^v?(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?(?:\.(0|[1-9]\d*))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/,
    );
  if (!match) return null;
  return {
    core: [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)],
    prerelease: match[4]
      ? match[4].split(".").map((part) => (/^(0|[1-9]\d*)$/.test(part) ? Number(part) : part))
      : [],
  };
}

export function isCatalogVersionNewer(installed: string, catalog: string) {
  const current = comparableVersion(installed);
  const available = comparableVersion(catalog);
  if (!current || !available) return false;

  for (let index = 0; index < current.core.length; index += 1) {
    if (available.core[index] !== current.core[index]) {
      return available.core[index] > current.core[index];
    }
  }
  if (current.prerelease.length === 0 || available.prerelease.length === 0) {
    return current.prerelease.length > 0 && available.prerelease.length === 0;
  }
  const length = Math.max(current.prerelease.length, available.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const currentPart = current.prerelease[index];
    const availablePart = available.prerelease[index];
    if (currentPart === undefined) return true;
    if (availablePart === undefined) return false;
    if (currentPart === availablePart) continue;
    if (typeof currentPart === "number" && typeof availablePart === "string") return true;
    if (typeof currentPart === "string" && typeof availablePart === "number") return false;
    return availablePart > currentPart;
  }
  return false;
}

export function toPluginEntry(
  catalog: PluginCatalogEntry,
  local: LocalPluginRecord | undefined,
  platform: string,
): PluginEntry {
  const installedVersion = prefer(local?.version, catalog.version);
  const artifact = defaultArtifact(catalog, platform);
  const updateAvailable = Boolean(
    local?.installed && artifact && isCatalogVersionNewer(installedVersion, catalog.version),
  );
  return {
    id: catalog.id,
    name: prefer(local?.name, catalog.name),
    version: installedVersion,
    catalog_version: local ? catalog.version : undefined,
    update_available: updateAvailable,
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
    artifact,
  };
}
