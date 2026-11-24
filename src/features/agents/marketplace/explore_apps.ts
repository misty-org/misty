import type { MarkRender } from "@misty/ui";
import type { ComponentType } from "react";

export interface ExploreCatalogApp {
  id: string;
  name: string;
  version: string;
  permissions: string[];
  logo: string;
  icon_render?: MarkRender;
}

export interface ExploreAppUpdate {
  app: ExploreCatalogApp;
  from: string;
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
  ): Promise<unknown>;
}

export interface ExploreAppsSectionProps {
  spaceId: string;
  canManage: boolean;
  query?: string;
  limit?: number;
  onSeeAll?: () => void;
  featured?: boolean;
}

export interface ExploreAppsParts {
  useAppUpdates(spaceId: string): ExploreAppUpdates;
  ExploreAppsSection: ComponentType<ExploreAppsSectionProps>;
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
