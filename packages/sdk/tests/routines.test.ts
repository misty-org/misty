import { expect, it } from "vitest";
import { MistyRoutineRunRecordSchema, MistyRoutineDefinitionSchema, MistyRoutineExecutionSchema, MistyRoutineValueSchema } from "@misty/contracts";
const pin = { capability: "habits.list", capabilityVersion: 1, providerId: "example.habits/backend", providerVersion: 1, targetId: crypto.randomUUID(), targetRevision: 1 };
const literal = (value: unknown) => ({ kind: "literal", value });
const reference = (stepId: string) => ({ kind: "reference", source: { kind: "step", stepId }, path: [] });
const definition = () => ({ protocol: 1, name: "Daily habits", trigger: { kind: "manual" }, budget: {}, steps: [
  { id: "read", label: "Read habits", kind: "capability", action: pin, input: literal({}) },
  { id: "summarize", label: "Summarize habits", kind: "capability", action: pin, input: reference("read") },
] });
it("pins an ordered routine with default bounds and explicit references", () => {
  const parsed = MistyRoutineDefinitionSchema.parse(definition());
  expect(parsed.budget).toEqual({ modelTurns: 20, activeSeconds: 1800 });
  expect(parsed.steps[0]).toMatchObject({ allowPartial: false });
});
it("rejects cyclic, forward, duplicate and prototype references before execution", () => {
  for (const bad of ["summarize", "future"]){
    const routine = definition(); routine.steps[0]!.input = reference(bad);
    expect(MistyRoutineDefinitionSchema.safeParse(routine).success).toBe(false);
  }
  const duplicate = definition(); duplicate.steps[1]!.id = "read";
  expect(MistyRoutineDefinitionSchema.safeParse(duplicate).success).toBe(false);
  expect(MistyRoutineValueSchema.safeParse({ ...reference("read"), path: ["__proto__"] }).success).toBe(false);
  const cycle: Record<string, unknown> = { kind: "literal" }; cycle.value = cycle;
  expect(MistyRoutineValueSchema.safeParse(cycle).success).toBe(false);
});
it("does not interpret reference-shaped literal content as a program", () => {
  const routine = definition(); routine.steps[0]!.input = literal(reference("future"));
  expect(MistyRoutineDefinitionSchema.safeParse(routine).success).toBe(true);
});
it("bounds the total model turns across agent steps", () => {
  const routine = { ...definition(), steps: [10, 11].map((maxTurns, index) => ({ id: `agent_${index}`, kind: "agent", label: "Summarize", prompt: literal("Summarize"), actions: [pin], maxTurns, outputSchema: { type: "object" } })) };
  expect(MistyRoutineDefinitionSchema.safeParse(routine).success).toBe(false);
});
it("validates timezone schedules and rejects duplicate occurrences", () => {
  const routine = { ...definition(), trigger: { kind: "schedule", timezone: "America/Los_Angeles", daysOfWeek: [1, 2, 3, 4, 5], times: [{ hour: 9, minute: 30 }] } };
  expect(MistyRoutineDefinitionSchema.safeParse(routine).success).toBe(true);
  expect(MistyRoutineDefinitionSchema.safeParse({ ...routine, trigger: { ...routine.trigger, timezone: "Unknown/Zone" } }).success).toBe(false);
  expect(MistyRoutineDefinitionSchema.safeParse({ ...routine, trigger: { ...routine.trigger, times: [...routine.trigger.times, ...routine.trigger.times] } }).success).toBe(false);
});
it("requires one unique admitted call per capability step", () => {
  const execution = { routineId: crypto.randomUUID(), version: 1, runId: "invocation_fixture", definition: definition(), trigger: {}, bindings: ["read", "summarize"].map(stepId => ({ stepId, callId: crypto.randomUUID(), toolName: "sdk.habits" })) };
  expect(MistyRoutineExecutionSchema.safeParse(execution).success).toBe(true);
  expect(MistyRoutineExecutionSchema.safeParse({ ...execution, bindings: execution.bindings.slice(0, 1) }).success).toBe(false);
  expect(MistyRoutineExecutionSchema.safeParse({ ...execution, bindings: execution.bindings.map(binding => ({ ...binding, callId: execution.bindings[0]!.callId })) }).success).toBe(false);
});
it("binds each agent step to exactly its admitted actions and one namespace", () => {
  const routine = { ...definition(), steps: [{ id: "summarize", kind: "agent", label: "Summarize", prompt: literal("Summarize"), actions: [pin], maxTurns: 2, outputSchema: { type: "object" } }] };
  const execution = { routineId: crypto.randomUUID(), version: 1, runId: "invocation_fixture", definition: routine, trigger: {}, bindings: [], agentBindings: [{ stepId: "summarize", callNamespace: crypto.randomUUID(), tools: [{ toolName: "sdk.habits", action: pin }] }] };
  expect(MistyRoutineExecutionSchema.safeParse(execution).success).toBe(true);
  expect(MistyRoutineExecutionSchema.safeParse({ ...execution, agentBindings: [] }).success).toBe(false);
  expect(MistyRoutineExecutionSchema.safeParse({ ...execution, agentBindings: [{ ...execution.agentBindings[0], tools: [{ toolName: "sdk.other", action: { ...pin, targetId: crypto.randomUUID() } }] }] }).success).toBe(false);
  expect(MistyRoutineExecutionSchema.safeParse({ ...execution, agentBindings: [...execution.agentBindings, ...execution.agentBindings] }).success).toBe(false);
});

it("represents a timer wait without granting a new capability or effect binding", () => {
  const execution = { routineId: crypto.randomUUID(), version: 1, runId: "invocation_wait", trigger: {}, bindings: [], definition: { protocol: 1, name: "Pause", trigger: { kind: "manual" }, budget: {}, steps: [{ id: "pause", label: "Wait", kind: "wait", until: literal("2026-09-08T09:00:00Z") }] } };
  const run = { requestId: crypto.randomUUID(), execution, state: "awaiting_timer", cancelRequested: false, outcome: "", report: null, wait: { waitId: crypto.randomUUID(), stepId: "pause", until: "2026-09-08T09:00:00Z", expiresAt: "2026-09-09T00:00:00Z" } };
  expect(MistyRoutineRunRecordSchema.safeParse(run).success).toBe(true);
  expect(MistyRoutineRunRecordSchema.safeParse({ ...run, wait: { ...run.wait, waitId: "active-tab" } }).success).toBe(false);
});
