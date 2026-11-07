import { BAD_SCHEMA, refuse } from "./api";

/** The same checks the tools' declared input schemas made on the server. */
type Input = Record<string, unknown>;

const invalid = () => refuse(BAD_SCHEMA);
const length = (value: string) => Array.from(value).length;

interface TextRule {
  min?: number;
  max?: number;
  required?: boolean;
  allowed?: readonly string[];
}

export function text(input: Input, name: string, rule: TextRule = {}): string {
  const value = input[name];
  if (value === undefined || value === null) {
    if (rule.required) throw invalid();
    return "";
  }
  if (typeof value !== "string") throw invalid();
  if (rule.min !== undefined && length(value) < rule.min) throw invalid();
  if (rule.max !== undefined && length(value) > rule.max) throw invalid();
  if (rule.allowed && !rule.allowed.includes(value)) throw invalid();
  return value;
}

export function integer(
  input: Input,
  name: string,
  min?: number,
  max?: number,
): number | undefined {
  const value = input[name];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value)) throw invalid();
  if ((min !== undefined && value < min) || (max !== undefined && value > max)) throw invalid();
  return value;
}

export function flag(input: Input, name: string): boolean | undefined {
  const value = input[name];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") throw invalid();
  return value;
}

interface ListRule {
  min?: number;
  max: number;
  required?: boolean;
  itemMin?: number;
  itemMax?: number;
  allowed?: readonly string[];
}

export function textList(input: Input, name: string, rule: ListRule): string[] | undefined {
  const value = input[name];
  if (value === undefined || value === null) {
    if (rule.required) throw invalid();
    return undefined;
  }
  if (!Array.isArray(value) || value.length > rule.max || value.length < (rule.min ?? 0)) {
    throw invalid();
  }
  for (const item of value) {
    if (typeof item !== "string") throw invalid();
    if (rule.itemMin !== undefined && length(item) < rule.itemMin) throw invalid();
    if (rule.itemMax !== undefined && length(item) > rule.itemMax) throw invalid();
    if (rule.allowed && !rule.allowed.includes(item)) throw invalid();
  }
  return value as string[];
}

/** For the tools whose schema refuses anything it doesn't name. */
export function onlyFields(input: Input, names: readonly string[]) {
  if (Object.keys(input).some((name) => !names.includes(name))) throw invalid();
}

/** Cuts text to a number of characters, the way the server shortened it. */
export function truncate(value: string, limit: number): string {
  const characters = Array.from(value);
  if (characters.length <= limit) return value;
  return `${characters
    .slice(0, limit - 1)
    .join("")
    .trim()}…`;
}
