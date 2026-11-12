// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
/**
 * The bundled persona catalog (agency-agents, MIT): the composer's `#` picker and the catalog in
 * Settings read it from native code, which checks every prompt against its pinned hash. Which
 * personas are switched off is a device setting in misty.db (`device:agent-catalog`); it never
 * syncs. Every persona is on until the person turns it off.
 */
import { invoke } from "@/native/invoke";
import type { AgentProfile } from "@/shared/schemas";
import { personalAgentsApi } from "../personal/personalAgentsApi";

export interface CatalogProvider {
  id: string;
  displayName: string;
  sourceUrl: string;
  sourceRevision: string;
  license: string;
}

export interface CatalogDivision {
  id: string;
  order: number;
  icon?: string | null;
  color?: string | null;
  label: string;
  count: number;
}

export interface CatalogPersona {
  id: string;
  divisionId: string;
  name: string;
  description: string;
  icon?: string | null;
  color?: string | null;
  vibe?: string | null;
}

export interface CatalogView {
  provider: CatalogProvider;
  divisions: CatalogDivision[];
  agents: CatalogPersona[];
}

export interface CatalogPrompt {
  id: string;
  name: string;
  description: string;
  icon?: string | null;
  prompt: string;
  promptHash: string;
}

let listing: Promise<CatalogView> | undefined;

/** The catalog, read once per window: the pack never changes while Misty runs. */
export function personaCatalog(): Promise<CatalogView> {
  listing ??= invoke<CatalogView>("agent_catalog_list").catch((error: unknown) => {
    listing = undefined;
    throw error;
  });
  return listing;
}

const prompts = new Map<string, Promise<CatalogPrompt>>();

export function personaPrompt(id: string): Promise<CatalogPrompt> {
  let pending = prompts.get(id);
  if (!pending) {
    pending = invoke<CatalogPrompt>("agent_catalog_prompt", { agentId: id }).catch(
      (error: unknown) => {
        prompts.delete(id);
        throw error;
      },
    );
    prompts.set(id, pending);
  }
  return pending;
}

// ---- which personas are on ----

const scope = "device:agent-catalog";
type Listener = (disabled: ReadonlySet<string>) => void;
const listeners = new Set<Listener>();
let disabledCache: Set<string> | undefined;

interface Saved {
  revision: number;
  disabled: Set<string>;
}

async function readSaved(): Promise<Saved> {
  const { revision, state } = await invoke<{
    revision: number;
    state: { disabled?: unknown } | null;
  }>("settings_session_state", { scope });
  const ids = Array.isArray(state?.disabled) ? state.disabled : [];
  return {
    revision,
    disabled: new Set(ids.filter((id): id is string => typeof id === "string")),
  };
}

/** The personas the person switched off. */
export async function disabledPersonas(): Promise<ReadonlySet<string>> {
  if (disabledCache) return disabledCache;
  disabledCache = (await readSaved().catch(() => ({ revision: 0, disabled: new Set<string>() })))
    .disabled;
  return disabledCache;
}

export function onPersonasChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Turns personas on or off. Retries once when another window wrote first. */
export async function setPersonasEnabled(ids: string[], enabled: boolean): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const saved = await readSaved();
    for (const id of ids) {
      if (enabled) saved.disabled.delete(id);
      else saved.disabled.add(id);
    }
    try {
      await invoke("settings_session_commit", {
        scope,
        revision: saved.revision,
        document: { disabled: [...saved.disabled].sort() },
      });
      disabledCache = saved.disabled;
      for (const listener of listeners) listener(saved.disabled);
      return;
    } catch (error) {
      if (attempt === 1) throw error;
    }
  }
}

/** The personas the `#` picker offers: every one the person hasn't switched off. */
export async function enabledPersonas(): Promise<CatalogPersona[]> {
  const [catalog, disabled] = await Promise.all([personaCatalog(), disabledPersonas()]);
  return catalog.agents.filter((agent) => !disabled.has(agent.id));
}

// ---- in a message ----

/** The word a persona goes by in a message: `#` and the last part of its id. */
export const personaToken = (id: string) => id.slice(id.lastIndexOf("/") + 1);

/**
 * The prompts of the personas a message names with `#token`, for the run's instructions. Only a
 * persona that is on counts; anything else stays plain text.
 */
export async function personaInstructions(prompt: string): Promise<string> {
  const tokens = new Set([...prompt.matchAll(/(?:^|\s)#([a-z0-9][a-z0-9-]*)/g)].map((m) => m[1]));
  if (!tokens.size) return "";
  const personas = await enabledPersonas().catch(() => [] as CatalogPersona[]);
  const named = personas.filter((persona) => tokens.has(personaToken(persona.id)));
  const texts = await Promise.all(
    named.map((persona) =>
      personaPrompt(persona.id)
        .then((found) => `## Persona: ${found.name}\n\n${found.prompt.trim()}`)
        .catch(() => ""),
    ),
  );
  return texts.filter(Boolean).join("\n\n");
}

/** Makes one of the person's own agents from a persona: its prompt becomes the agent's soul. */
export async function makeAgentFromPersona(id: string): Promise<AgentProfile> {
  const persona = await personaPrompt(id);
  return personalAgentsApi.save({
    name: persona.name.slice(0, 80),
    role: persona.description.slice(0, 160),
    description: persona.description.slice(0, 2000),
    instructions: "",
    soul: persona.prompt.slice(0, 100000),
    icon: "sparkles",
    avatar: persona.icon ? { kind: "emoji", value: persona.icon } : {},
    model_mode: "automatic",
    model_id: "",
    reasoning_effort: "",
    enabled: true,
    default_run_mode: "ask",
    origin: persona.id,
  });
}
