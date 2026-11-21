import type { ComponentType } from "react";

/*
 * Explore shows a Space's apps, but the apps belong to the Spaces feature, which itself builds on
 * this one. So Explore takes them from a seam the app's shell fills at startup
 * (`src/app/featureSeams.ts`), with only the shapes it needs declared here.
 */

/** An app of the catalog, as Explore uses it. */
export interface ExploreCatalogApp {
  id: string;
  name: string;
  version: string;
  permissions: string[];
  logo: string;
}

/** A Space app with a newer version to take, and where it came from. */
export interface ExploreAppUpdate {
  app: ExploreCatalogApp;
  from: string;
  source?: unknown;
}

export interface ExploreAppUpdates {
  updates: ExploreAppUpdate[];
  loaded: boolean;
  error: string;
  reload(): void;
  install(
    appId: string,
    version: string,
    permissions: string[],
    source?: unknown,
  ): Promise<unknown>;
}

export interface ExploreAppsSectionProps {
  spaceId: string;
  canManage: boolean;
  query?: string;
  limit?: number;
  only?: readonly "open"[];
  onSeeAll?: () => void;
  featured?: boolean;
  startGroup?: "all" | "connected";
}

export interface ExploreAppsParts {
  useAppUpdates(spaceId: string): ExploreAppUpdates;
  ExploreAppsSection: ComponentType<ExploreAppsSectionProps>;
  catalogLogoUrl(app: Pick<ExploreCatalogApp, "logo">): string;
}

let parts: ExploreAppsParts | null = null;

/** The shell hands Explore the Spaces feature's app pieces, once at startup. */
export function provideExploreApps(next: ExploreAppsParts) {
  parts = next;
}

export function exploreApps(): ExploreAppsParts {
  if (!parts) throw new Error("Explore's apps were not provided (src/app/featureSeams.ts)");
  return parts;
}
