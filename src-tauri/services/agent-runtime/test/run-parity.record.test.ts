import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, vi } from "vitest";
import { setDeviceModels } from "../src/device-models.js";
import { runParityCase as run } from "./run-parity.cases.js";

/**
 * Records every model call the real loop makes for a fixed scripted run, with the real WorkflowAgent
 * and only the network and the Workflow engine mocked, as a fixture
 * `src-tauri/crates/agent/src/runtime/run/parity_tests.rs` compares the Rust loop with. Never reaches a
 * provider. Run it after changing the loop or upgrading the SDK:
 *
 *   MISTY_RECORD_RUN_PARITY=1 npx vitest run test/run-parity.record.test.ts
 */
const recording = process.env.MISTY_RECORD_RUN_PARITY === "1";

setDeviceModels({ version: 1, providers: {}, models: { agent: run.modelId }, reasoning: run.reasoning as "medium" });

const fixture = vi.hoisted(() => ({
  events: [] as Array<{ action: string; body: unknown; key: string }>,
  executed: [] as Array<{ id: string; name: string; input: string; token: string }>,
}));

vi.mock("workflow", () => ({
  getWorkflowMetadata: () => ({ workflowRunId: "wrun_parity" }),
  FatalError: class extends Error {},
  RetryableError: class extends Error {},
  defineHook: () => ({}),
  sleep: async () => undefined,
}));
vi.mock("../src/control-plane.js", () => ({
  controlPlaneRequest: async (_identity: unknown, action: string, body: Record<string, unknown>, key: string) => {
    fixture.events.push({ action, body, key });
    const { runParityCase } = await import("./run-parity.cases.js");
    if (action === "context") return { model_id: runParityCase.modelId, system: runParityCase.system, prompt: runParityCase.prompt, allowed_tools: runParityCase.catalog.map((tool) => tool.name), model_turn_limit: runParityCase.turnLimit };
    if (action === "steering") return { messages: [], closed: true };
    if (action === "budget") return { version: 1, remaining_ms: 1_800_000, active: true, deadline: new Date(Date.now() + 1_800_000).toISOString() };
    if (action === "mcp-token") return { access_token: "t", token_type: "Bearer", expires_in: 300, mcp_path: "/mcp", protocol: "2026-07-28" };
    return { accepted: true };
  },
}));
vi.mock("../src/mcp-runtime.js", async () => ({
  discoverRemoteMCPTools: async () => (await import("./run-parity.cases.js")).runParityCase.catalog,
  requestMCPToolExecution: async (_context: unknown, _access: unknown, id: string, name: string, input: unknown, token: string) => {
    fixture.executed.push({ id, name, input: JSON.stringify(input), token });
    const output = (await import("./run-parity.cases.js")).runParityCase.toolOutputs[id];
    if (typeof output === "string") {
      const split = output.indexOf(": ");
      return { tool_error: { code: output.slice(0, split), message: output.slice(split + 2) } };
    }
    return { result: output };
  },
}));
vi.mock("../src/instance-model.js", async () => {
  const shared = await import("./run-parity.model.js");
  return { InstanceModel: class { constructor() { return shared.model; } } };
});

describe.runIf(recording)("run parity recorder", () => {
  it("records the model calls of a scripted run", async () => {
    const { calls } = await import("./run-parity.model.js");
    const { runSpaceTaskAgent } = await import("../workflows/space-task-agent.js");
    const ended = await runSpaceTaskAgent({ mistyRunId: "run_parity", controlPlaneURL: "https://control.invalid", runKey: "k" });
    const out = resolve(import.meta.dirname, "../../../crates/agent/tests/fixtures/run_parity");
    mkdirSync(out, { recursive: true });
    const events = fixture.events.filter((event) => event.action !== "budget").map(({ action, key, body }) => ({ action, key, body }));
    writeFileSync(resolve(out, "scripted_run.json"), `${JSON.stringify({ case: run, modelCalls: calls, events, executed: fixture.executed, ended: { text: ended.text, steps: ended.steps, incomplete: ended.incomplete } }, null, 1)}\n`);
  });
});
