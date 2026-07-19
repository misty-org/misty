import { describe, expect, it } from "vitest";
import { workflowTemplates } from "./templates";
import { createWorkflowNode, validateWorkflowV2, type WorkflowDefinitionV2 } from "./v2";

describe("workflow v2 contract", () => {
  it("ships twelve valid production templates", () => {
    expect(workflowTemplates).toHaveLength(12);
    for (const template of workflowTemplates) {
      expect(validateWorkflowV2(template.definition), template.name).toEqual([]);
      const nodes = [...template.definition.nodes, ...template.definition.nodes.flatMap((node) => {
        const child = node.config.childGraph as WorkflowDefinitionV2 | undefined;
        return child?.nodes ?? [];
      })];
      expect(nodes.every((node) => node.id.startsWith(`${template.id}_`)), template.name).toBe(true);
      for (const task of nodes.filter((node) => node.kind === "agent_task")) {
        expect(String(task.config.instructions).length, template.name).toBeGreaterThan(40);
        expect(task.config.requireCitations, template.name).toBe(true);
      }
    }
  });

  it("rejects graph cycles and capability expansion", () => {
    const first = createWorkflowNode("read_content");
    const second = createWorkflowNode("create_document");
    const definition: WorkflowDefinitionV2 = {
      formatVersion: 2,
      inputs: { type: "object" },
      outputs: { type: "object" },
      capabilities: [{ capability: "content.read", risk: "read" }],
      nodes: [first, second],
      edges: [
        { id: "a", source: first.id, sourcePort: "output", target: second.id, targetPort: "input" },
        { id: "b", source: second.id, sourcePort: "output", target: first.id, targetPort: "input" },
      ],
      dependencies: [],
    };
    const errors = validateWorkflowV2(definition);
    expect(errors.some((error) => error.includes("cycle"))).toBe(true);
    expect(errors.some((error) => error.includes("files.write"))).toBe(true);
  });
});
