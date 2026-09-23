import { expect, it } from "vitest";
import {
  checklistForInvocation,
  checklistSummary,
  nestChildren,
  upsertChecklist,
} from "./checklists";
import type { AgentChecklist } from "./types";

const list = (overrides: Partial<AgentChecklist>): AgentChecklist => ({
  invocationId: "inv_parent",
  conversationId: "c1",
  items: [
    { id: "s1", title: "Read the code", status: "done" },
    { id: "s2", title: "Edit tests", status: "in_progress", delegated: true },
    { id: "s3", title: "Report back", status: "pending" },
  ],
  version: 2,
  updatedAt: "2026-10-14T10:00:00Z",
  ...overrides,
});

it("drops a replayed older version and keeps newer ones", () => {
  const current = [list({})];
  expect(upsertChecklist(current, list({ version: 1, items: [] }))).toBe(current);
  expect(upsertChecklist(current, list({ version: 2, items: [] }))).toBe(current);
  const next = upsertChecklist(current, list({ version: 3, items: [] }));
  expect(next).toHaveLength(1);
  expect(next[0]?.version).toBe(3);
});

it("finds a run's checklist and nests delegated runs under delegated steps", () => {
  const child = list({ invocationId: "inv_child", parentInvocationId: "inv_parent", version: 1 });
  const all = upsertChecklist([list({})], child);
  const { checklist, children } = checklistForInvocation(all, "inv_parent");
  expect(checklist?.invocationId).toBe("inv_parent");
  expect(children.map((item) => item.invocationId)).toEqual(["inv_child"]);
  expect(nestChildren(checklist!.items, children).get("s2")).toEqual([child]);
  expect(checklistForInvocation(all, "inv_child").checklist).toBeUndefined();
});

it("summarizes progress in one line", () => {
  expect(checklistSummary(list({}).items)).toBe("1 of 3 · Edit tests");
  expect(checklistSummary(list({}).items, "Stopped")).toBe("1 of 3 · Stopped: Edit tests");
  expect(checklistSummary([{ id: "a", title: "A", status: "done" }])).toBe("1 of 1 · Done");
});
