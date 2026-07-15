import { describe, expect, it } from "vitest";
import { planAgentWorkflow, plannedMutation } from "./workflow";
import type { AgentWorkflow } from "./types";

const workflow = (edges: AgentWorkflow["edges"]): AgentWorkflow => ({
  version: 1,
  revision: 1,
  nodes: [
    { id: "manual", kind: "manual_trigger", config: {}, policy: [] },
    { id: "webhook", kind: "local_webhook", config: {}, policy: [] },
    { id: "task", kind: "mika_task", config: {}, policy: [{ action: "summarize", mode: "automatic" }] },
    { id: "delete", kind: "approval", config: { action: { kind: "delete", summary: "Delete processed input", relativePaths: ["inbox/report.pdf"] } }, policy: [{ action: "delete", mode: "approval" }] },
  ],
  edges,
});

describe("agent workflow planning", () => {
  it("executes only nodes reachable from the exact trigger", () => {
    const value = workflow([{ from: "manual", to: "task" }, { from: "webhook", to: "delete" }]);
    const manual = planAgentWorkflow(value, "manual");
    expect(manual.nodes.map((node) => node.id)).toEqual(["manual", "task"]);
    expect(plannedMutation(manual, "scope_abcdefgh")).toBeNull();
    expect(plannedMutation(planAgentWorkflow(value, "local_webhook"), "scope_abcdefgh")).toMatchObject({
      kind: "delete",
      relativePaths: ["inbox/report.pdf"],
    });
  });

  it("fails closed on cycles, dangling edges, and traversal paths", () => {
    expect(() => planAgentWorkflow(workflow([{ from: "manual", to: "missing" }]), "manual")).toThrow(/dangling/);
    expect(() => planAgentWorkflow(workflow([{ from: "manual", to: "task" }, { from: "task", to: "manual" }]), "manual")).toThrow(/cycle/);
    const unsafe = workflow([{ from: "webhook", to: "delete" }]);
    unsafe.nodes[3].config = { action: { kind: "delete", summary: "Delete", relativePaths: ["../secret"] } };
    expect(() => plannedMutation(planAgentWorkflow(unsafe, "local_webhook"), "scope_abcdefgh")).toThrow(/invalid relative path/);
  });

  it("distinguishes created and changed file-event roots", () => {
    const value: AgentWorkflow = {
      version: 1,
      revision: 1,
      nodes: [
        { id: "created", kind: "file_event", config: { event: "file_created" }, policy: [] },
        { id: "changed", kind: "file_event", config: { event: "file_changed" }, policy: [] },
        { id: "create-task", kind: "mika_task", config: {}, policy: [] },
        { id: "change-task", kind: "reply", config: {}, policy: [] },
      ],
      edges: [{ from: "created", to: "create-task" }, { from: "changed", to: "change-task" }],
    };
    expect(planAgentWorkflow(value, "file_created").nodes.map((node) => node.id)).toEqual(["created", "create-task"]);
  });
});
