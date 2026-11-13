import { mistyEngine, type EngineModel } from "../../../engines/enginesApi";
import { rememberedEffort } from "./composerChoices";

/*
 * Reasoning effort, as each engine states it per model (native `models::ModelDetails`: Claude
 * Code's account catalog, `codex debug models`, Pi's `models --json`, CodeBuddy's shipped
 * registry). Misty keeps no list of levels of its own: a model the engine says nothing about
 * offers no effort choice, and its run passes none, so the engine uses its own.
 */

/** The levels a model takes, by id, as its engine lists them. Empty when it says none. */
export function modelEfforts(engine: string | undefined, model?: EngineModel): string[] {
  if (!engine || engine === mistyEngine) return [];
  return model?.efforts?.map((level) => level.id) ?? [];
}

/** A level's name: the engine's own ("Extra") when it gives one, else its id written out. */
export function effortLabel(effort: string, model?: EngineModel): string {
  const named = model?.efforts?.find((level) => level.id === effort)?.name;
  if (named) return named;
  return effort === "xhigh" ? "Extra high" : effort.charAt(0).toUpperCase() + effort.slice(1);
}

/** What the engine notes on a level ("Recommended", "3.5× or more usage"), if anything. */
export function effortNote(effort: string, model?: EngineModel): string | undefined {
  return model?.efforts?.find((level) => level.id === effort)?.badge ?? undefined;
}

/** The first of `candidates` the model takes, else Medium, else its first level. */
export function pickEffort(
  levels: readonly string[],
  candidates: ReadonlyArray<string | null | undefined>,
): string {
  for (const level of [...candidates, "medium"]) if (level && levels.includes(level)) return level;
  return levels[0] ?? "";
}

/**
 * The level a chat runs its model at: the chat's own pick, else the level last picked with that
 * model, else the agent's, else the engine's own level for the model (Claude Code's remembered
 * one, Codex's default), else Medium when the engine names no default. What the composer shows
 * is what the engine is asked for. Empty for a model the engine lists no levels for.
 */
export function effectiveEffort(input: {
  engine: string | undefined;
  /** The model's id as the chat names it, "" for the engine's default. */
  modelId: string;
  model?: EngineModel;
  chosen?: string;
  agentEffort?: string;
}): string {
  return pickEffort(modelEfforts(input.engine, input.model), [
    input.chosen,
    rememberedEffort(input.engine, input.model?.id ?? input.modelId),
    input.agentEffort,
    input.model?.defaultEffort,
  ]);
}
