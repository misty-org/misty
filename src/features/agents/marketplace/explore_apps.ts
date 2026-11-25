import type { MarkRender } from "@misty/ui";

export interface ExploreCatalogApp {
  id: string;
  kind?: "site";
  name: string;
  description?: string;
  maker: string;
  upstream: string;
  license: string;
  version: string;
  size: number;
  permissions: string[];
  logo: string;
  icon_render?: MarkRender;
  banner?: string;
  screenshots?: string[];
}

export interface ExploreInstalledApps {
  listed: readonly ExploreCatalogApp[];
  loaded: boolean;
  error: string;
  reload(): void;
  versionOf(appId: string): string | undefined;
  approvedOf(appId: string): string[];
  downloadOf(appId: string): { received: number; total: number } | undefined;
  install(appId: string, version: string, permissions: string[]): Promise<unknown>;
  remove(appId: string): Promise<unknown>;
  open(appId: string): void;
  permissionLine(permission: string): string;
  isSite(app: ExploreCatalogApp): boolean;
  siteHost(app: ExploreCatalogApp): string;
}

export interface ExploreAppsParts {
  useExploreInstalledApps(spaceId: string): ExploreInstalledApps;
  catalogLogoUrl(app: Pick<ExploreCatalogApp, "logo">): string;
}

let parts: ExploreAppsParts | null = null;

export function provideExploreApps(next: ExploreAppsParts) {
  parts = next;
}

export function exploreApps(): ExploreAppsParts {
  if (!parts) throw new Error("Explore's apps were not provided (src/app/feature_seams.ts)");
  return parts;
}
