import { describe, expect, it } from "vitest";
import type { AgentDefinition } from "../agents/types";
import type { AutomationWorkflow } from "../api/types";
import {
  agentDefinitionToMf,
  automationWorkflowToMf,
  mfToAgentWorkflow,
  mfToAutomationWorkflow,
  validateMfWorkflow,
} from "./mf";

describe(".mf workflow documents", () => {
  it("round-trips an automation as a disabled imported draft", () => {
    const workflow: AutomationWorkflow = {
      format: "misty.workflow", formatVersion: 1, id: "automation-1", revision: 4, profile: "automation",
      name: "Morning brief", description: "Build a brief", enabled: true, intervalMinutes: 60,
      nodes: [
        { id: "manual", kind: "manual_trigger", label: "Manual", position: { x: 10, y: 20 }, config: {}, policy: [] },
        { id: "agent", kind: "create_agent", label: "Create agent", position: { x: 220, y: 20 }, config: { name: "Helper" }, policy: [{ capability: "create_agent", mode: "approval" }] },
      ],
      edges: [{ id: "edge", source: "manual", target: "agent" }], createdAt: "2026-01-01", updatedAt: "2026-01-02",
    };
    const document = automationWorkflowToMf(workflow);
    expect(validateMfWorkflow(document)).toEqual([]);
    const imported = mfToAutomationWorkflow(document);
    expect(imported).toMatchObject({ enabled: false, revision: 1, intervalMinutes: 60 });
    expect(imported.nodes[1].policy).toEqual([{ capability: "create_agent", mode: "approval" }]);
  });

  it("preserves Agent policies and converts canonical edges", () => {
    const definition = agentDefinition();
    const document = agentDefinitionToMf(definition);
    expect(document.profile).toBe("agent");
    expect(document.edges[0]).toMatchObject({ source: "manual", target: "task" });
    const workflow = mfToAgentWorkflow(document, 3);
    expect(workflow.revision).toBe(3);
    expect(workflow.edges[0]).toEqual({ from: "manual", to: "task" });
    expect(workflow.nodes[1].policy).toEqual([{ action: "summarize", mode: "automatic" }]);
  });
});

function agentDefinition(): AgentDefinition {
  return {
    id: "agent-1", ownerAccountId: "owner", deviceId: "device", scope: { id: "scope", deviceId: "device", displayName: "Reports", kind: "local_folder", relativePath: null, available: true },
    name: "Reports", instructions: "Summarize reports", status: "draft", cloudDocumentConsent: false, members: [],
    triggers: [{ id: "trigger", kind: "manual", enabled: true }],
    trustPolicy: { automaticActions: ["summarize"], approvalRequiredActions: [], memberWriteAccess: false, approvalTtlHours: 24 },
    workflow: {
      version: 1, revision: 2,
      nodes: [
        { id: "manual", kind: "manual_trigger", config: { editorPosition: { x: 10, y: 20 } }, policy: [] },
        { id: "task", kind: "mika_task", config: {}, policy: [{ action: "summarize", mode: "automatic" }] },
      ],
      edges: [{ from: "manual", to: "task" }],
    },
    workflowId: "workflow-1", workflowRevision: 2, version: 1, createdAt: "2026-01-01", updatedAt: "2026-01-02",
  };
}
