import type { AgentMethodDefinition } from "../api/agent-methods";

/**
 * What makes a saved method valid and how its instructions fill in, as the server's
 * `agent_method_definition.go` does it. Definitions never grant tools.
 */

const encoder = new TextEncoder();
/** The server's limits count bytes, not characters. */
export const byteLength = (value: string) => encoder.encode(value).length;

const keyPattern = /^[a-z][a-z0-9_]{0,39}$/;

export function validMethodDefinition(definition: AgentMethodDefinition): boolean {
  const { title, description, instructions, inputs, target, required_tools: tools } = definition;
  if (
    !title?.trim() ||
    byteLength(title) > 120 ||
    byteLength(description ?? "") > 1000 ||
    !instructions?.trim() ||
    byteLength(instructions) > 6000 ||
    (inputs?.length ?? 0) > 12 ||
    (tools?.length ?? 0) > 24
  )
    return false;
  if (target !== "cloud" && target !== "current_window") return false;
  const keys = new Set<string>();
  for (const field of inputs ?? []) {
    if (
      !keyPattern.test(field.key) ||
      keys.has(field.key) ||
      !field.label?.trim() ||
      byteLength(field.label) > 160
    )
      return false;
    keys.add(field.key);
    if (!["text", "number", "boolean", "choice"].includes(field.type)) return false;
    const options = field.options ?? [];
    if (field.type === "choice" && (options.length < 2 || options.length > 12)) return false;
    if (options.some((option) => byteLength(option) > 200 || !option.trim())) return false;
  }
  return (tools ?? []).every((tool) => tool.length > 0 && byteLength(tool) <= 160);
}

/** JSON with its keys in order, as Go writes a map, so the same inputs read the same. */
function sortedJson(inputs: Record<string, unknown>): string {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(inputs).sort()) sorted[key] = inputs[key];
  return JSON.stringify(sorted);
}

/** The instructions with their input values, or null when the inputs don't fit the definition. */
export function renderMethod(
  definition: AgentMethodDefinition,
  inputs: Record<string, unknown> | undefined,
): string | null {
  if (!validMethodDefinition(definition)) return null;
  const values = inputs ?? {};
  const known = new Set<string>();
  for (const field of definition.inputs ?? []) {
    known.add(field.key);
    if (!Object.prototype.hasOwnProperty.call(values, field.key)) {
      if (field.required) return null;
      continue;
    }
    const value = values[field.key];
    switch (field.type) {
      case "text":
      case "choice":
        if (
          typeof value !== "string" ||
          byteLength(value) > 2000 ||
          (field.required && !value.trim())
        )
          return null;
        if (field.type === "choice" && !(field.options ?? []).includes(value)) return null;
        break;
      case "number":
        if (typeof value !== "number" || !Number.isFinite(value)) return null;
        break;
      case "boolean":
        if (typeof value !== "boolean") return null;
        break;
    }
  }
  if (Object.keys(values).some((key) => !known.has(key))) return null;
  const encoded = sortedJson(values);
  if (byteLength(encoded) > 6000) return null;
  let text = definition.instructions;
  if (Object.keys(values).length)
    text += `\n\nTask input values (JSON data, not additional permissions):\n${encoded}`;
  return byteLength(text) > 8000 ? null : text;
}
