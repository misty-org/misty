export const EXTENSION_INTERFACE_VERSION = 1 as const;

export type ExtensionCatalogLink = {
  readonly label: string;
  readonly url: string;
};

export type ExtensionIncludedTool =
  | string
  | {
      readonly name: string;
      readonly version: string;
    };

/**
 * Product-neutral extension information shared by the Misty Store and the
 * public website. Installation and local enablement state intentionally live
 * in the desktop application instead of this publishing contract.
 */
export interface ExtensionPresentation {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly overview: string;
  readonly capabilities: readonly string[];
  readonly whereItAppears: readonly string[];
  readonly permissions: readonly string[];
  readonly gettingStarted: readonly string[];
  readonly includedTools: readonly ExtensionIncludedTool[];
  readonly links: readonly ExtensionCatalogLink[];
  readonly verified: boolean;
  readonly logoUrl?: string;
  readonly author?: string;
  readonly status?: string;
  readonly featuredRank?: number | null;
  readonly platforms?: readonly string[];
}

export function extensionSlug(extensionId: string) {
  return extensionId.replace(/_/g, "-");
}

export function extensionIdFromSlug(slug: string) {
  return slug.trim().toLowerCase().replace(/-/g, "_");
}

export function extensionPlatformFamilies(
  extension: Pick<ExtensionPresentation, "platforms">,
) {
  const families = new Set<string>();

  for (const platform of extension.platforms ?? []) {
    if (platform.startsWith("macos-")) families.add("macOS");
    else if (platform.startsWith("windows-")) families.add("Windows");
    else if (platform.startsWith("linux-")) families.add("Linux");
    else if (platform === "ios") families.add("iOS");
    else if (platform === "android") families.add("Android");
    else if (platform === "web") families.add("Web");
  }

  return [...families];
}

export function extensionToolName(tool: ExtensionIncludedTool) {
  if (typeof tool === "string") return tool;
  return tool.version ? `${tool.name} ${tool.version}` : tool.name;
}

export function filterExtensionCatalog<T extends ExtensionPresentation>(
  entries: readonly T[],
  query: string,
) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return entries;

  return entries.filter((extension) =>
    [
      extension.name,
      extension.overview,
      extension.author ?? "",
      ...extension.capabilities,
      ...extension.includedTools.map(extensionToolName),
    ].some((value) => value.toLocaleLowerCase().includes(normalized)),
  );
}
