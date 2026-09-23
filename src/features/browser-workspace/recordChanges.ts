import { sameValue } from "./changes";
import type { SharedRecord, WorkspaceChange } from "./model";
/** Diff navigation records by field; a rename never writes a stale order or URL. */
export function recordChanges(before: SharedRecord[], after: SharedRecord[]): WorkspaceChange[] {
  const key = (record: SharedRecord) => `${record.kind}/${record.id}`;
  const old = new Map(before.map((record) => [key(record), record]));
  const next = new Map(after.map((record) => [key(record), record]));
  if (old.size !== before.length || next.size !== after.length)
    throw new Error("Duplicate website navigation identities");
  const changes: WorkspaceChange[] = [];
  for (const [id, record] of next) {
    const previous = old.get(id);
    if (!previous) changes.push({ action: "create", ...record } as WorkspaceChange);
    else {
      const fields = Object.fromEntries(
        Object.entries(record.fields).filter(
          ([name, value]) =>
            !sameValue((previous.fields as unknown as Record<string, unknown>)[name], value),
        ),
      );
      if (Object.keys(fields).length)
        changes.push({
          action: "patch",
          kind: record.kind,
          id: record.id,
          fields,
        } as WorkspaceChange);
    }
  }
  for (const [id, record] of old)
    if (!next.has(id)) changes.push({ action: "delete", kind: record.kind, id: record.id });
  return changes;
}
