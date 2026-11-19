import { refreshCachedResource, useCachedResource } from "@/api/cache/cached-resource";
import { invoke } from "@/native/invoke";
import { spaceWindow } from "@/features/app-windows";
import { agentAccountId } from "../personal/agentAccount";
import { modelName, rememberModelNames } from "./modelNames";

/** An agent engine Misty has an adapter for, and whether it is installed on this computer. */
export interface EngineInfo {
  id: string;
  name: string;
  installed: boolean;
  version: string | null;
  /** Whether it takes images (screenshots, a crop to point at). */
  supportsImages?: boolean;
  /** Whether it mounts Misty's MCP tools (the Space, the browser). */
  supportsMcp?: boolean;
  /** Whether its CLI brings its own web search. */
  supportsWebSearch?: boolean;
  supportsEffort?: boolean;
  /** The engine's own modes offered here (`engineModes.ts`); native code decides what each passes. */
  modes?: Array<{ id: string; label: string; kind: "asks" | "edits" | "plans" | "no_asking" }>;
}

/** Misty's own runtime, which needs nothing installed. */
export const mistyEngine = "misty";

/** Where the engine list is kept: one copy for every screen, saved on this computer. */
const enginesKey = "engines/list";
const loadEngines = () => invoke<EngineInfo[]>("engines_list");

/**
 * The engines on this computer, asked of native code afresh (it runs each CLI's `--version`).
 * Every screen showing them gets the answer too, and two asks at once share one.
 */
export const listEngines = () =>
  refreshCachedResource(enginesKey, loadEngines, "device", { join: true });

/**
 * The engines, for a screen: the last list paints at once, even right after launch, and a fresh
 * one follows behind it. `loading` is true only the very first time, with nothing saved.
 */
export const useEnginesList = () =>
  useCachedResource(enginesKey, loadEngines, { persist: "device" });

/** A model an engine can be asked for; `default` marks the one it uses when none is named. */
export interface EngineModel {
  /** What the engine is asked for ("opus", "default", "gpt-5.5"). */
  id: string;
  /** Its name as the engine gives it ("Opus 5.5", "GPT-5.6-Luna"), else its id. */
  label: string;
  /** The muted line under it: its concrete id, or what a selector stands for. */
  detail?: string | null;
  /** The model it runs, by name ("Opus 5.5" for Claude Code's "default"). */
  runs?: string | null;
  /**
   * Its reasoning-effort levels as the engine lists them, weakest first, with the engine's own
   * names and notes; null when the engine doesn't say, empty when the model takes none.
   */
  efforts?: EngineEffort[] | null;
  /** The level the engine itself would use for it (its remembered one, else its default). */
  defaultEffort?: string | null;
  contextWindow?: number | null;
  /** "more" when the engine's own menu keeps it under "More models". */
  section?: "main" | "more" | null;
  /** The engine's own fast mode for it, by the engine's name, and what turns it on. */
  fast?: { label: string; tier: string } | null;
  /** A note the engine shows with it. */
  notice?: string | null;
  /** The engine's own current pick, which a chat that names no model gets. */
  default: boolean;
}

/** One reasoning-effort level as an engine offers it for a model. */
export interface EngineEffort {
  /** What the run passes ("xhigh"). */
  id: string;
  /** The engine's own name for it ("Extra"). */
  name?: string;
  /** The engine's own line about it. */
  description?: string;
  /** A short tag the engine puts on it ("Recommended"). */
  badge?: string;
}

/** The engine's own models, then the model names the person added for it in Agents › Channels. */
export async function listEngineModels(engine: string): Promise<EngineModel[]> {
  const [models, settings] = await Promise.all([
    invoke<EngineModel[]>("engine_models", { engine }),
    invoke<{ customModels?: Record<string, string[]> }>("engine_settings_get").catch(() => null),
  ]);
  const known = new Set(models.map((model) => model.id));
  const added = (settings?.customModels?.[engine] ?? [])
    .filter((id) => id.trim() && !known.has(id))
    .map((id): EngineModel => ({ id, label: id, default: false }));
  // Each model by the engine's own name; the names are kept for ids shown elsewhere.
  const all = [...models, ...added].map((model) => ({
    ...model,
    label: modelName(model.label ?? "", model.id),
  }));
  rememberModelNames(all);
  return all;
}

const modelCache = new Map<string, Promise<EngineModel[]>>();
// Agents › Channels changed (a channel, or the model names the person added): read them again.
if (typeof window !== "undefined")
  window.addEventListener("misty:engine-channels-changed", () => modelCache.clear());

/** An engine's models, read once and shared by the composer and the run that sends its turn. */
export function engineModels(engine: string): Promise<EngineModel[]> {
  let pending = modelCache.get(engine);
  if (!pending) {
    pending = listEngineModels(engine).catch(() => []);
    modelCache.set(engine, pending);
  }
  return pending;
}

/**
 * Engines whose model list is exactly what the person's account can run (Codex, Pi and Oh My Pi:
 * `models/usable.rs`). A model saved earlier that it no longer lists can't run there.
 */
const ACCOUNT_LISTED = new Set(["codex", "omp", "pi"]);

/**
 * A saved model pick as it can run: on an engine that lists exactly what the account runs, one
 * it no longer lists is set aside (""), so the chat shows and runs the engine's own pick instead.
 * Any other engine, or a list that hasn't loaded or is empty, keeps the pick as it is.
 */
export function usablePick(
  engine: string,
  models: readonly EngineModel[] | undefined,
  id: string,
): string {
  if (!id || !ACCOUNT_LISTED.has(engine) || !models?.length) return id;
  return models.some((model) => model.id === id) ? id : "";
}

/** The model a chat runs: the one named, else the engine's own default. */
export function modelNamed(
  models: readonly EngineModel[] | undefined,
  id: string,
): EngineModel | undefined {
  return id ? models?.find((model) => model.id === id) : models?.find((model) => model.default);
}

/** One of an engine's slash commands or skills, and what the composer inserts to use it. */
export interface EngineCatalogItem {
  name: string;
  description: string;
  source: "builtin" | "user" | "project";
  insert: string;
  argumentHint?: string;
  /** Who runs it: the engine, sent as the next message, or Misty, out of turn
   * (`engineCommands.ts`). */
  runs?: "turn" | "misty";
}

export interface EngineCatalog {
  commands: EngineCatalogItem[];
  skills: EngineCatalogItem[];
}

/** An engine's commands and skills, from its own folders and the chat's linked folder. */
export const engineCatalog = (engine: string, folder: string) =>
  invoke<EngineCatalog>("engine_catalog", { account: agentAccountId(), engine, folder });

/** A file or folder inside a linked folder, for the composer's `@` menu. */
interface FoundFile {
  path: string;
  relative: string;
  isDir: boolean;
}

export const findFiles = (folder: string, query: string) =>
  invoke<FoundFile[]>("project_find_files", { account: agentAccountId(), folder, query });

/** The Space this window shows, as the key what is kept per Space is kept under. */
export const currentSpaceKey = () => spaceWindow().spaceId ?? "";

/** A folder's own name, for a row that has no room for its whole path. */
export const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;
