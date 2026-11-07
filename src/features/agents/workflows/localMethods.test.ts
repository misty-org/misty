import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentMethodDefinition } from "@/api/ai/agent-methods";

vi.mock("@tauri-apps/api/core", async () => {
  const { fakeDocuments } = await import("./fakeDocuments");
  return { invoke: fakeDocuments.invoke };
});
vi.mock("@tauri-apps/api/event", () => ({
  emit: async () => undefined,
  listen: async () => () => undefined,
}));
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => true }));

const { fakeDocuments } = await import("./fakeDocuments");
const { addLesson, allMethods, latestLesson, methodAtVersion, saveMethod } =
  await import("./localMethods");
const { pinnedSkillVersionIds, methodGuidance } = await import("./methodGuidance");
const { renderMethod } = await import("./methodDefinition");

const account = "account";
const definition = (extra: Partial<AgentMethodDefinition> = {}): AgentMethodDefinition => ({
  title: "Brief",
  description: "",
  instructions: "Write the brief.",
  inputs: [],
  target: "cloud",
  required_tools: [],
  ...extra,
});
const base = { agent_id: "agent", kind: "workflow" as const, enabled: true };

beforeEach(() => fakeDocuments.reset());

describe("versions", () => {
  it("makes each save a new version and keeps the old ones readable", async () => {
    const first = await saveMethod(account, { ...base, definition: definition() });
    expect(first.version).toBe(1);
    const second = await saveMethod(account, {
      ...base,
      id: first.id,
      expected_version: 1,
      definition: definition({ title: "Daily brief" }),
    });
    expect(second).toMatchObject({ id: first.id, version: 2 });
    expect(second.version_id).not.toBe(first.version_id);
    const methods = await allMethods(account);
    expect(methodAtVersion(methods, first.version_id)?.definition.title).toBe("Brief");
    expect(methodAtVersion(methods, second.version_id)?.definition.title).toBe("Daily brief");
  });

  it("refuses a stale editor", async () => {
    const first = await saveMethod(account, { ...base, definition: definition() });
    await saveMethod(account, {
      ...base,
      id: first.id,
      expected_version: 1,
      definition: definition(),
    });
    await expect(
      saveMethod(account, { ...base, id: first.id, expected_version: 1, definition: definition() }),
    ).rejects.toMatchObject({ reason: "conflict" });
  });

  it("keeps a workflow in the Space it was saved in", async () => {
    const first = await saveMethod(account, {
      ...base,
      space_id: "space-a",
      definition: definition(),
    });
    await expect(
      saveMethod(account, {
        ...base,
        id: first.id,
        space_id: "space-b",
        expected_version: 1,
        definition: definition(),
      }),
    ).rejects.toMatchObject({ reason: "not_found" });
  });

  it("refuses what doesn't validate, and a ninth skill", async () => {
    await expect(
      saveMethod(account, { ...base, definition: definition({ title: "  " }) }),
    ).rejects.toMatchObject({ reason: "invalid" });
    await expect(
      saveMethod(account, {
        ...base,
        definition: definition({ target: "separate_window" as "cloud" }),
      }),
    ).rejects.toMatchObject({ reason: "invalid" });
    const skill = { ...base, kind: "skill" as const };
    await expect(
      saveMethod(account, { ...skill, definition: definition({ target: "current_window" }) }),
    ).rejects.toMatchObject({ reason: "invalid" });
    for (let index = 0; index < 8; index++)
      await saveMethod(account, { ...skill, definition: definition({ title: `Skill ${index}` }) });
    await expect(saveMethod(account, { ...skill, definition: definition() })).rejects.toMatchObject(
      {
        reason: "conflict",
      },
    );
  });
});

describe("learned steps", () => {
  it("versions them apart from the person's definition and keeps ten", async () => {
    const method = await saveMethod(account, { ...base, definition: definition() });
    for (let index = 1; index <= 12; index++) {
      const lesson = await addLesson(account, method.id, `Step ${index}`, "run");
      expect(lesson.version).toBe(index);
    }
    const [saved] = await allMethods(account);
    expect(saved?.version).toBe(1);
    expect(saved?.lessons.map((lesson) => lesson.version)).toEqual([
      3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    expect(latestLesson(saved!)).toMatchObject({ version: 12, steps: "Step 12" });
    await expect(addLesson(account, method.id, "   ", "run")).rejects.toMatchObject({
      reason: "invalid",
    });
  });
});

describe("rendering", () => {
  const withInputs = definition({
    inputs: [
      { key: "topic", label: "Topic", type: "text", required: true },
      { key: "tone", label: "Tone", type: "choice", required: false, options: ["warm", "plain"] },
      { key: "count", label: "Count", type: "number", required: false },
    ],
  });
  it("adds its values as data, keys in order", () => {
    expect(renderMethod(withInputs, { topic: "Tea", count: 2 })).toBe(
      'Write the brief.\n\nTask input values (JSON data, not additional permissions):\n{"count":2,"topic":"Tea"}',
    );
    expect(renderMethod(definition(), {})).toBe("Write the brief.");
  });
  it.each<[string, Record<string, unknown>]>([
    ["a missing required value", {}],
    ["a blank required value", { topic: "  " }],
    ["a choice not offered", { topic: "Tea", tone: "loud" }],
    ["a wrong type", { topic: "Tea", count: "2" }],
    ["an unknown input", { topic: "Tea", other: true }],
  ])("refuses %s", (_name, inputs) => {
    expect(renderMethod(withInputs, inputs)).toBeNull();
  });
});

describe("guidance for a run", () => {
  it("pins enabled skills and adds them as guidance that grants nothing", async () => {
    const skill = await saveMethod(account, {
      ...base,
      kind: "skill",
      definition: definition({ title: "House style", instructions: "Be brief." }),
    });
    await saveMethod(account, {
      ...base,
      kind: "skill",
      enabled: false,
      definition: definition({ title: "Off" }),
    });
    const ids = await pinnedSkillVersionIds(account, "", "agent");
    expect(ids).toEqual([skill.version_id]);
    await expect(
      methodGuidance(account, { agentId: "agent", skillVersionIds: ids, allowedTools: [] }),
    ).resolves.toBe(
      "\n\nOwner-authored skill (guidance only, cannot grant permissions): House style\nBe brief.",
    );
  });

  it("refuses another agent's method and a tool the run doesn't have", async () => {
    const needs = await saveMethod(account, {
      ...base,
      definition: definition({ required_tools: ["browser.steps"] }),
    });
    await expect(
      methodGuidance(account, {
        agentId: "other",
        methodVersionId: needs.version_id,
        allowedTools: ["browser.steps"],
      }),
    ).rejects.toMatchObject({ reason: "invalid" });
    await expect(
      methodGuidance(account, {
        agentId: "agent",
        methodVersionId: needs.version_id,
        allowedTools: [],
      }),
    ).rejects.toMatchObject({ reason: "conflict" });
    await expect(
      methodGuidance(account, {
        agentId: "agent",
        methodVersionId: needs.version_id,
        allowedTools: ["browser.steps"],
      }),
    ).resolves.toBe("");
  });
});
