import type { PluginBrowserEntry, PluginBrowserLauncher, PluginBrowserLink } from "./types";

const DEFAULT_CATALOG_BASE_URL =
  "https://raw.githubusercontent.com/misty-org/misty-plugins/main/catalog";

export const pluginCatalogBaseUrl =
  import.meta.env.VITE_PLUGIN_CATALOG_BASE_URL ?? DEFAULT_CATALOG_BASE_URL;

type PluginCatalogIndexEntry = {
  id: string;
  name: string;
  url: string;
};

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
  links?: PluginBrowserLink[];
  verified?: boolean;
  launcher?: Partial<PluginBrowserLauncher>;
  manifest?: {
    id?: string;
    name?: string;
    version?: string;
    author?: string;
    description?: string;
  };
  install?: {
    root?: string;
  };
};

function resolveUrl(path: string) {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  return new URL(path.replace(/^\/+/, ""), `${pluginCatalogBaseUrl}/`).toString();
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
    return `https://raw.githubusercontent.com/${owner}/${repo}/main/catalog/plugins/${entry.id}.json`;
  }

  return resolveUrl(entry.url);
}

function normalizeCatalogEntry(
  indexEntry: PluginCatalogIndexEntry,
  raw: RawPluginCatalogFile,
): PluginBrowserEntry {
  return {
    id: raw.manifest?.id ?? raw.id ?? indexEntry.id,
    name: raw.manifest?.name ?? raw.name ?? indexEntry.name,
    version: raw.manifest?.version ?? raw.version ?? "0.0.0",
    author: raw.manifest?.author ?? raw.author ?? "Misty",
    overview: raw.overview ?? raw.manifest?.description ?? "",
    installed: false,
    enabled: false,
    verified: raw.verified ?? false,
    logoSrc: raw.logo_path ? resolveUrl(raw.logo_path) : undefined,
    rootLabel: raw.install?.root ?? "public",
    capabilities: raw.capabilities ?? [],
    whereItAppears: raw.where_it_appears ?? [],
    permissions: raw.permissions ?? [],
    gettingStarted: raw.getting_started ?? [],
    changelog: raw.changelog ?? [],
    links: raw.links ?? [],
    launcher: {
      views: raw.launcher?.views ?? [],
      show_in_launcher: raw.launcher?.show_in_launcher ?? false,
      requires_selected_file: raw.launcher?.requires_selected_file ?? false,
      open_mode: raw.launcher?.open_mode ?? "tab",
    },
  };
}

export async function loadPluginCatalog() {
  const indexResponse = await fetch(`${pluginCatalogBaseUrl}/index.json`, { cache: "no-store" });
  if (!indexResponse.ok) {
    throw new Error(`Could not load plugin catalog index: ${indexResponse.status}`);
  }

  const index = (await indexResponse.json()) as PluginCatalogIndexEntry[];
  return Promise.all(
    index.map(async (entry) => {
      const response = await fetch(catalogEntryUrl(entry), { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Could not load plugin catalog entry ${entry.id}: ${response.status}`);
      }
      return normalizeCatalogEntry(entry, (await response.json()) as RawPluginCatalogFile);
    }),
  );
}
