import { useMemo } from "react";
import { useRegistry } from "@/native/registry";

export type EngineInstallRoute = "maker-build" | "npm" | "script" | "none";

export interface CatalogEngine {
  id: string;
  name: string;
  maker?: string;
  source?: string;
  install: { route: EngineInstallRoute; npm?: string; windows?: string };
}

export const useRegistryEngines = (): readonly CatalogEngine[] =>
  useRegistry((state) => state.engines.engines) as readonly CatalogEngine[];

export function useRegistryEngineIds(): readonly string[] {
  const engines = useRegistryEngines();
  return useMemo(() => engines.map((engine) => engine.id), [engines]);
}

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

export function engineMatches(engine: CatalogEngine, query: string): boolean {
  const words = query.trim().toLowerCase();
  if (!words) return true;
  return `${engine.name} ${engine.maker ?? ""}`.toLowerCase().includes(words);
}
