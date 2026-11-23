import { mistyEngine, type EngineModel } from "../../../engines/engines_api";
import { rememberedEffort } from "./composer_choices";

export function modelEfforts(engine: string | undefined, model?: EngineModel): string[] {
  if (!engine || engine === mistyEngine) return [];
  return model?.efforts?.map((level) => level.id) ?? [];
}

export function effortLabel(effort: string, model?: EngineModel): string {
  const named = model?.efforts?.find((level) => level.id === effort)?.name;
  if (named) return named;
  return effort === "xhigh" ? "Extra high" : effort.charAt(0).toUpperCase() + effort.slice(1);
}

export function effortNote(effort: string, model?: EngineModel): string | undefined {
  return model?.efforts?.find((level) => level.id === effort)?.badge ?? undefined;
}

export function pickEffort(
  levels: readonly string[],
  candidates: ReadonlyArray<string | null | undefined>,
): string {
  for (const level of [...candidates, "medium"]) if (level && levels.includes(level)) return level;
  return levels[0] ?? "";
}

export function effectiveEffort(input: {
  engine: string | undefined;
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
