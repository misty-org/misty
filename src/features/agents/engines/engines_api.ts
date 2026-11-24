import { refreshCachedResource, useCachedResource } from "@/api/cache/cached_resource";
import { invoke } from "@/native/invoke";
import { spaceWindow } from "@/features/app-windows";
import { agentAccountId } from "../personal/agent_account";
import { modelName, rememberModelNames } from "./model_names";

export interface EngineInfo {
  id: string;
  name: string;
  installed: boolean;
  version: string | null;
  supportsImages?: boolean;
  supportsMcp?: boolean;
  supportsWebSearch?: boolean;
  supportsEffort?: boolean;
  modes?: Array<{ id: string; label: string; kind: "asks" | "edits" | "plans" | "no_asking" }>;
}

export { mistyEngine } from "./misty_engine";

const enginesKey = "engines/list";
const loadEngines = () => invoke<EngineInfo[]>("engines_list");

export const listEngines = () =>
  refreshCachedResource(enginesKey, loadEngines, "device", { join: true });

export const useEnginesList = () =>
  useCachedResource(enginesKey, loadEngines, { persist: "device" });

export interface EngineModel {
  id: string;
  label: string;
  detail?: string | null;
  runs?: string | null;
  efforts?: EngineEffort[] | null;
  defaultEffort?: string | null;
  contextWindow?: number | null;
  section?: "main" | "more" | null;
  fast?: { label: string; tier: string } | null;
  notice?: string | null;
  default: boolean;
}

export interface EngineEffort {
  id: string;
  name?: string;
  description?: string;
  badge?: string;
}

export async function listEngineModels(engine: string): Promise<EngineModel[]> {
  const [models, settings] = await Promise.all([
    invoke<EngineModel[]>("engine_models", { engine }),
    invoke<{ customModels?: Record<string, string[]> }>("engine_settings_get").catch(() => null),
  ]);
  const known = new Set(models.map((model) => model.id));
  const added = (settings?.customModels?.[engine] ?? [])
    .filter((id) => id.trim() && !known.has(id))
    .map((id): EngineModel => ({ id, label: id, default: false }));
  const all = [...models, ...added].map((model) => ({
    ...model,
    label: modelName(model.label ?? "", model.id),
  }));
  rememberModelNames(all);
  return all;
}

const modelCache = new Map<string, Promise<EngineModel[]>>();
if (typeof window !== "undefined")
  window.addEventListener("misty:engine-channels-changed", () => modelCache.clear());

export function engineModels(engine: string): Promise<EngineModel[]> {
  let pending = modelCache.get(engine);
  if (!pending) {
    pending = listEngineModels(engine).catch(() => []);
    modelCache.set(engine, pending);
  }
  return pending;
}

const ACCOUNT_LISTED = new Set(["codex"]);

export function usablePick(
  engine: string,
  models: readonly EngineModel[] | undefined,
  id: string,
): string {
  if (!id || !ACCOUNT_LISTED.has(engine) || !models?.length) return id;
  return models.some((model) => model.id === id) ? id : "";
}

export function modelNamed(
  models: readonly EngineModel[] | undefined,
  id: string,
): EngineModel | undefined {
  return id ? models?.find((model) => model.id === id) : models?.find((model) => model.default);
}

export interface EngineCatalogItem {
  name: string;
  description: string;
  source: "builtin" | "user" | "project";
  insert: string;
  argumentHint?: string;
  runs?: "turn" | "misty";
}

export interface EngineCatalog {
  commands: EngineCatalogItem[];
  skills: EngineCatalogItem[];
}

export const engineCatalog = (engine: string, folder: string) =>
  invoke<EngineCatalog>("engine_catalog", { account: agentAccountId(), engine, folder });

interface FoundFile {
  path: string;
  relative: string;
  isDir: boolean;
}

export const findFiles = (folder: string, query: string) =>
  invoke<FoundFile[]>("project_find_files", { account: agentAccountId(), folder, query });

export const currentSpaceKey = () => spaceWindow().spaceId ?? "";

export const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;
