export interface AutomationStep {
  name: string;
  type: string;
  displayName: string;
  parentName: string | null;
  relationship: string;
  valid: boolean;
  configStatus: string;
  branchIndex?: number;
  branchName?: string;
}

export interface AutomationStructure {
  flowId: string;
  displayName: string;
  steps: AutomationStep[];
}

export interface AutomationRun {
  id: string;
  flowId: string;
  status: string;
  created: string;
  duration: string;
  failedStepName: string;
}

export interface AutomationCatalogResult {
  pieceName: string;
  componentName: string;
  displayName: string;
  description: string;
  connected: boolean;
}

export function normalizeAutomationStructure(value: unknown): AutomationStructure | null {
  const root = unwrap(value);
  if (!isObject(root)) return null;
  const flowId = stringValue(root.flowId) || stringValue(root.id);
  const displayName = stringValue(root.displayName) || stringValue(root.name);
  const rows = Array.isArray(root.steps) ? root.steps : [];
  if (!flowId && !rows.length) return null;
  return {
    flowId,
    displayName,
    steps: rows.flatMap((row) => {
      if (!isObject(row)) return [];
      const name = stringValue(row.name);
      if (!name) return [];
      return [{
        name,
        type: stringValue(row.type) || "PIECE",
        displayName: stringValue(row.displayName) || name,
        parentName: nullableString(row.parentName),
        relationship: stringValue(row.relationship) || "next",
        valid: row.valid === true,
        configStatus: stringValue(row.configStatus),
        branchIndex: typeof row.branchIndex === "number" ? row.branchIndex : undefined,
        branchName: stringValue(row.branchName) || undefined,
      } satisfies AutomationStep];
    }),
  };
}

export function normalizeAutomationRuns(value: unknown): AutomationRun[] {
  const root = unwrap(value);
  const rows = isObject(root) && Array.isArray(root.runs) ? root.runs : [];
  return rows.flatMap((row) => {
    if (!isObject(row)) return [];
    const id = stringValue(row.id);
    if (!id) return [];
    return [{
      id,
      flowId: stringValue(row.flowId),
      status: stringValue(row.status) || "UNKNOWN",
      created: stringValue(row.created),
      duration: stringValue(row.duration),
      failedStepName: stringValue(row.failedStepName),
    }];
  });
}

export function normalizeCatalogResults(value: unknown, kind: "action" | "trigger") {
  const root = unwrap(value);
  const rows = isObject(root) && Array.isArray(root.results) ? root.results : [];
  return rows.flatMap((row): AutomationCatalogResult[] => {
    if (!isObject(row)) return [];
    const pieceName = stringValue(row.pieceName) || stringValue(row.piece_name);
    const componentName = kind === "action"
      ? stringValue(row.actionName) || stringValue(row.action_name) || stringValue(row.name)
      : stringValue(row.triggerName) || stringValue(row.trigger_name) || stringValue(row.name);
    if (!pieceName || !componentName) return [];
    return [{
      pieceName,
      componentName,
      displayName: stringValue(row.displayName) || stringValue(row.display_name) || humanize(componentName),
      description: stringValue(row.description) || stringValue(row.oneLineDescription),
      connected: row.connected === true,
    }];
  });
}

function unwrap(value: unknown): unknown {
  if (isObject(value) && "structured_content" in value) return value.structured_content;
  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 500) : "";
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function humanize(value: string) {
  return value.replace(/^@activepieces\/piece-/, "").replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
