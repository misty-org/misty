export interface AutomationFlow {
  id: string;
  name: string;
  status: "enabled" | "disabled" | "unknown";
  trigger: string;
  published?: boolean;
}

export function normalizeActivepiecesFlows(
  structured: unknown,
  text: string[] = [],
): AutomationFlow[] {
  const candidates = [structured, ...text.map(parseText)].filter(Boolean);
  for (const candidate of candidates) {
    const rows = flowRows(candidate);
    if (!rows.length) continue;
    return rows.flatMap((row) => {
      if (!isObject(row)) return [];
      const id = stringValue(row.id) || stringValue(row.flowId);
      const name =
        stringValue(row.displayName) || stringValue(row.name) || stringValue(row.flowName);
      if (!id || !name) return [];
      const rawStatus = (stringValue(row.status) || stringValue(row.state)).toUpperCase();
      return [
        {
          id,
          name,
          status:
            rawStatus === "ENABLED" || rawStatus === "ACTIVE"
              ? "enabled"
              : rawStatus === "DISABLED" || rawStatus === "INACTIVE"
                ? "disabled"
                : "unknown",
          trigger:
            stringValue(row.triggerType) ||
            stringValue(row.trigger) ||
            stringValue(row.triggerName) ||
            "Trigger not configured",
          ...(typeof row.published === "boolean" ? { published: row.published } : {}),
        } satisfies AutomationFlow,
      ];
    });
  }
  return [];
}

function flowRows(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isObject(value)) return [];
  for (const key of ["flows", "data", "items", "results"]) {
    const nested = value[key];
    if (Array.isArray(nested)) return nested;
    const rows = flowRows(nested);
    if (rows.length) return rows;
  }
  return [];
}

function parseText(value: string): unknown {
  const trimmed = value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 240) : "";
}
