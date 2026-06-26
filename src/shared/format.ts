export function prettyLabel(value: string): string {
  return value.split("_").join(" ");
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
