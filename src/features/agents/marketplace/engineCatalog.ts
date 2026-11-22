import { useMemo } from "react";
import { useRegistry } from "@/native/registry";

/**
 * The engines Misty's catalog knows (`misty-catalog`'s engines.json, carried with each release by
 * `npm run sync:catalog`): who makes each, where it comes from and how it installs. Whether one is
 * on this computer, signed in or behind is the engine's own CLI's answer, never the catalog's.
 */

/** How an engine installs: the maker's own build or installer, npm, the maker's script, or not
 * through Misty at all. */
export type EngineInstallRoute = "maker-build" | "npm" | "script" | "none";

export interface CatalogEngine {
  id: string;
  name: string;
  maker?: string;
  /** The engine's own page or repository. */
  source?: string;
  install: { route: EngineInstallRoute; npm?: string; windows?: string };
}

export const useRegistryEngines = (): readonly CatalogEngine[] =>
  useRegistry((state) => state.engines.engines) as readonly CatalogEngine[];

export function useRegistryEngineIds(): readonly string[] {
  const engines = useRegistryEngines();
  return useMemo(() => engines.map((engine) => engine.id), [engines]);
}

/** How it installs, as the details say it. */
export function installRouteText(route: EngineInstallRoute): string {
  switch (route) {
    case "maker-build":
      return "Maker's build";
    case "npm":
      return "npm";
    case "script":
      return "Maker's script";
    case "none":
      return "Not through Misty";
  }
}

/** Whether an engine matches the rail's search: its name or its maker. */
export function engineMatches(engine: CatalogEngine, query: string): boolean {
  const words = query.trim().toLowerCase();
  if (!words) return true;
  return `${engine.name} ${engine.maker ?? ""}`.toLowerCase().includes(words);
}
