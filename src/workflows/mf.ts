import type { AgentDefinition, AgentWorkflow } from "../agents/types";
import type { AutomationNodeKind, AutomationWorkflow } from "../api/types";

export const mfWorkflowFormat = "misty.workflow" as const;
export const mfWorkflowFormatVersion = 1 as const;

export type MfWorkflowProfile = "automation" | "agent" | "universal";
export type MfWorkflowPolicyMode = "automatic" | "approval";

export interface MfWorkflowPolicy {
  capability: string;
  mode: MfWorkflowPolicyMode;
}

export interface MfWorkflowNode {
  id: string;
  kind: string;
  label: string;
  position: { x: number; y: number };
  config: Record<string, unknown>;
  policy: MfWorkflowPolicy[];
}

export interface MfWorkflowEdge {
  id: string;
  source: string;
  target: string;
}

export interface MfWorkflowDocument {
  format: typeof mfWorkflowFormat;
  formatVersion: typeof mfWorkflowFormatVersion;
  id: string;
  revision: number;
  profile: MfWorkflowProfile;
  name: string;
  description: string;
  nodes: MfWorkflowNode[];
  edges: MfWorkflowEdge[];
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface MfWorkflowFile {
  path: string;
  document: MfWorkflowDocument;
}

export function automationWorkflowToMf(workflow: AutomationWorkflow): MfWorkflowDocument {
  return {
    format: mfWorkflowFormat,
    formatVersion: mfWorkflowFormatVersion,
    id: workflow.id,
    revision: workflow.revision,
    profile: workflow.profile,
    name: workflow.name,
    description: workflow.description,
    nodes: workflow.nodes.map((node) => ({
      id: node.id,
      kind: node.kind,
      label: node.label,
      position: node.position,
      config: node.config,
      policy: node.policy,
    })),
    edges: workflow.edges.map((edge) => ({ ...edge })),
    settings: {
      ...(workflow.intervalMinutes ? { intervalMinutes: workflow.intervalMinutes } : {}),
    },
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt,
  };
}

export function mfToAutomationWorkflow(document: MfWorkflowDocument): AutomationWorkflow {
  const now = new Date().toISOString();
  return {
    format: mfWorkflowFormat,
    formatVersion: mfWorkflowFormatVersion,
    id: crypto.randomUUID(),
    revision: 1,
    profile: document.profile === "agent" ? "universal" : document.profile,
    name: `${document.name} (imported)`,
    description: document.description,
    enabled: false,
    intervalMinutes: positiveNumber(document.settings.intervalMinutes),
    nodes: document.nodes.map((node) => ({
      id: node.id,
      kind: node.kind as AutomationNodeKind,
      label: node.label,
      position: node.position,
      config: node.config,
      policy: node.policy,
    })),
    edges: document.edges.map((edge) => ({ ...edge })),
    createdAt: now,
    updatedAt: now,
  };
}

export function agentDefinitionToMf(definition: AgentDefinition): MfWorkflowDocument {
  return {
    format: mfWorkflowFormat,
    formatVersion: mfWorkflowFormatVersion,
    id: definition.workflowId || definition.id,
    revision: definition.workflowRevision,
    profile: "agent",
    name: definition.name,
    description: definition.instructions,
    nodes: definition.workflow.nodes.map((node, index) => ({
      id: node.id,
      kind: node.kind,
      label: agentNodeLabel(node.kind),
      position: editorPosition(node.config.editorPosition, index),
      config: withoutEditorPosition(node.config),
      policy: node.policy.map((entry) => ({ capability: entry.action, mode: entry.mode })),
    })),
    edges: definition.workflow.edges.map((edge, index) => ({
      id: `${edge.from}:${edge.to}:${index}`,
      source: edge.from,
      target: edge.to,
    })),
    settings: {
      agent: {
        cloudDocumentConsent: definition.cloudDocumentConsent,
        triggers: definition.triggers.map((trigger) => ({
          kind: trigger.kind,
          enabled: trigger.enabled,
          schedule: trigger.schedule ?? null,
        })),
      },
    },
    createdAt: definition.createdAt,
    updatedAt: definition.updatedAt,
  };
}

export function mfToAgentWorkflow(document: MfWorkflowDocument, revision: number): AgentWorkflow {
  return {
    version: 1,
    revision,
    nodes: document.nodes.map((node) => ({
      id: node.id,
      kind: node.kind as AgentWorkflow["nodes"][number]["kind"],
      config: { ...node.config, editorPosition: node.position },
      policy: node.policy.map((entry) => ({
        action: entry.capability as AgentWorkflow["nodes"][number]["policy"][number]["action"],
        mode: entry.mode,
      })),
    })),
    edges: document.edges.map((edge) => ({ from: edge.source, to: edge.target })),
  };
}

export function validateMfWorkflow(document: MfWorkflowDocument): string[] {
  const errors: string[] = [];
  if (document.format !== mfWorkflowFormat) errors.push("This is not a Misty workflow file.");
  if (document.formatVersion !== mfWorkflowFormatVersion) errors.push(`Unsupported .mf version ${document.formatVersion}.`);
  if (!document.name.trim()) errors.push("Workflow name is required.");
  if (!isRecord(document.settings)) errors.push("Workflow settings must be an object.");
  const nodeIds = new Set<string>();
  for (const node of document.nodes) {
    if (!node.id.trim()) errors.push("Node IDs cannot be empty.");
    if (nodeIds.has(node.id)) errors.push(`Duplicate node ID: ${node.id}.`);
    nodeIds.add(node.id);
    if (!isRecord(node.config)) errors.push(`Node ${node.id} config must be an object.`);
  }
  for (const edge of document.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) errors.push(`Edge ${edge.id} points to a missing node.`);
  }
  return errors;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function editorPosition(value: unknown, index: number): { x: number; y: number } {
  if (value && typeof value === "object") {
    const position = value as Record<string, unknown>;
    if (typeof position.x === "number" && typeof position.y === "number") return { x: position.x, y: position.y };
  }
  return { x: 80 + (index % 4) * 210, y: 80 + Math.floor(index / 4) * 130 };
}

function withoutEditorPosition(config: Record<string, unknown>): Record<string, unknown> {
  const { editorPosition: _editorPosition, ...rest } = config;
  return rest;
}

function agentNodeLabel(kind: string): string {
  return kind.split("_").map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join(" ");
}
