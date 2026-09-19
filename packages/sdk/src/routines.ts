import { MistyRoutineDefinitionSchema, type MistyRoutineDefinition } from "@misty/contracts";

/** Validate a routine draft. This does not save it, enable it, or grant authority. */
export function defineMistyRoutine(input: unknown): MistyRoutineDefinition {
  return MistyRoutineDefinitionSchema.parse(input);
}
