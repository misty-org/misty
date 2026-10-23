/** Typed reads of one value from a settings document, with a fallback. */
function sectionRecord(
  document: Record<string, unknown>,
  section: string,
): Record<string, unknown> {
  const value = document[section];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function numberSetting(
  document: Record<string, unknown>,
  section: string,
  key: string,
  fallback: number,
): number {
  const value = sectionRecord(document, section)[key];
  return typeof value === "number" ? value : fallback;
}

export function booleanSetting(
  document: Record<string, unknown>,
  section: string,
  key: string,
  fallback: boolean,
): boolean {
  const value = sectionRecord(document, section)[key];
  return typeof value === "boolean" ? value : fallback;
}

export function stringSetting(
  document: Record<string, unknown>,
  section: string,
  key: string,
  fallback: string,
): string {
  const value = sectionRecord(document, section)[key];
  return typeof value === "string" ? value : fallback;
}
