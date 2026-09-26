import { describe, expect, it, vi } from "vitest";
import { EditJournal } from "./editJournal";
import type { WorkspaceChange } from "./model";
const identity = {
  deployment: "https://misty.test",
  account_id: "a",
  workspace_id: "w",
  device_id: "d",
};
const change: WorkspaceChange = {
  action: "patch",
  kind: "window",
  id: "window:a",
  fields: { title: "Work" },
};
function disk() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };
}
describe("durable renderer edit journal", () => {
  it("preserves IDs and batches across restart, isolated by account and deployment", () => {
    const storage = disk(),
      journal = new EditJournal(storage, identity);
    journal.append(Array.from({ length: 257 }, () => change));
    expect(journal.pending.map((edit) => edit.changes.length)).toEqual([256, 1]);
    expect(new EditJournal(storage, identity).pending).toEqual(journal.pending);
    expect(new EditJournal(storage, { ...identity, account_id: "other" }).pending).toEqual([]);
    expect(
      new EditJournal(storage, { ...identity, deployment: "https://other.test" }).pending,
    ).toEqual([]);
  });
  it("retains pending edits when either append or acknowledgment cannot persist", () => {
    const storage = disk(),
      journal = new EditJournal(storage, identity);
    journal.append([change]);
    const original = structuredClone(journal.pending);
    storage.setItem.mockImplementationOnce(() => {
      throw new Error("quota");
    });
    expect(() => journal.append([change])).toThrow("quota");
    expect(journal.pending).toEqual(original);
    storage.setItem.mockImplementationOnce(() => {
      throw new Error("quota");
    });
    expect(() => journal.acknowledge(original[0].id)).toThrow("quota");
    expect(new EditJournal(storage, identity).pending).toEqual(original);
    expect(() => journal.acknowledge("wrong")).toThrow("out of order");
    journal.acknowledge(original[0].id);
    expect(new EditJournal(storage, identity).pending).toEqual([]);
  });
});
