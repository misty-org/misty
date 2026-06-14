import { httpRequest } from "@/api/client/http";

// The catalog is fetched unauthenticated, so it has to live in a public
// repository. misty-org/misty is private: raw.githubusercontent.com answers
// 404 there for anyone without a token, which reads as an empty marketplace.
// The public misty-extensions repository owns and publishes the catalog.
export const DEFAULT_CATALOG_BASE_URL =
  "https://raw.githubusercontent.com/misty-org/misty-extensions/main/catalog";

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

const baseUrl = normalizeCatalogBaseUrl(
  import.meta.env.VITE_EXTENSIONS_URL ??
    import.meta.env.VITE_EXTENSION_CATALOG_BASE_URL ??
    import.meta.env.VITE_PLUGIN_CATALOG_BASE_URL,
);

export const extensionCatalogApi = {
  baseUrl,
  sourceArchiveUrl: githubSourceArchiveUrlForCatalog(baseUrl),
  indexText: () => readText(`${baseUrl}/index.json`, "extension catalog index.json"),
  firstAvailableText: async (urls: string[], label: string) => {
    let lastStatus = "";
    for (const url of Array.from(new Set(urls))) {
      const response = await httpRequest(url);
      if (response.ok) return response.text();
      lastStatus = `${response.status} from ${url}`;
    }
    throw new Error(`Could not load ${label}: ${lastStatus}`);
  },
};

async function readText(url: string, label: string): Promise<string> {
  const response = await httpRequest(url);
  if (!response.ok) throw new Error(`Could not load ${label}: ${response.status}`);
  return response.text();
}
