import { createHash, randomUUID } from "node:crypto";
import { chmodSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { MistyCapabilityExecutionSchema, MistyCapabilityTargetSchema, MistyCapabilityOutcomeSchema } from "@misty/contracts";
import { appID, connectionID, manifest } from "./manifest.ts";

const canonical = (value) => JSON.stringify(value, (_key, item) =>
  item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item);
const failure = (code, message) => ({ status: "failure", code, message, retryable: false });
const validObject = (input, keys) => input && typeof input === "object" && !Array.isArray(input)
  && Object.keys(input).every((key) => keys.includes(key));
const text = (value, min, max) => typeof value === "string" && value.trim().length >= min && value.length <= max;
const entryFrom = (row) => ({ id: row.id, name: row.name, day: row.day, note: row.note, revision: 1 });

/** One private provider instance per account. A transaction stores the effect and
 * habit together, so a lost HTTP response can be replayed across process restarts. */
export function openHabitAdapter(filename) {
  const database = new DatabaseSync(filename);
  if (filename !== ":memory:") chmodSync(filename, 0o600);
  database.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS habits(sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,name TEXT NOT NULL,day TEXT NOT NULL,note TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS effects(id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,outcome TEXT NOT NULL);`);
  return {
    close: () => database.close(),
    execute(raw, idempotencyKey) {
      const parsedExecution = MistyCapabilityExecutionSchema.safeParse(raw?.execution);
      const parsedTarget = MistyCapabilityTargetSchema.safeParse(raw?.target);
      if (raw?.protocol !== 1 || Object.keys(raw).some((key) => !["protocol", "execution", "target"].includes(key)) || !parsedExecution.success || !parsedTarget.success)
        return failure("invalid_execution", "A valid host execution envelope is required.");
      const execution = parsedExecution.data, target = parsedTarget.data;
      if (execution.effectId !== idempotencyKey || execution.providerId !== manifest.providers[0].id || execution.providerVersion !== 1 || execution.capabilityVersion !== 1 ||
          target.id !== execution.targetId || target.revision !== execution.targetRevision || target.appId !== appID || target.providerId !== execution.providerId || target.providerVersion !== 1 ||
          target.binding.kind !== "backend" || target.binding.connectionId !== connectionID)
        return failure("target_mismatch", "The execution does not match this provider and target.");
      // A transport may shorten the deadline to the run's remaining execution
      // allowance. It does not change the logical effect or authorize a new one.
      const stable = { ...raw, execution: { ...raw.execution } };
      delete stable.execution.deadline;
      const fingerprint = "v2:" + createHash("sha256").update(canonical(stable)).digest("hex");
      const legacyFingerprint = createHash("sha256").update(canonical(raw)).digest("hex");
      database.exec("BEGIN IMMEDIATE");
      try {
        const previous = database.prepare("SELECT fingerprint,outcome FROM effects WHERE id=?").get(execution.effectId);
        if (previous) {
          database.exec("COMMIT");
          // Older receipts can still replay their exact original envelope. Their
          // missing source input cannot be reconstructed to upgrade a fingerprint.
          return [fingerprint, legacyFingerprint].includes(previous.fingerprint) ? JSON.parse(previous.outcome) : failure("effect_conflict", "This effect was already bound to different input or a different target.");
        }
        if (Date.parse(execution.deadline) <= Date.now()) throw new Error("deadline_expired");
        const input = execution.input;
        let result, partial = false;
        if (execution.capability === "habits.record") {
          if (!validObject(input, ["name", "day", "note"]) || !text(input.name, 1, 120) || !/^\d{4}-\d{2}-\d{2}$/.test(input.day ?? "") ||
              !Number.isFinite(Date.parse(input.day)) || new Date(input.day).toISOString().slice(0,10) !== input.day || (input.note !== undefined && !text(input.note, 0, 2000))) throw new Error("invalid_input");
          result = { id: randomUUID(), name: input.name, day: input.day, note: input.note ?? "", revision: 1 };
          database.prepare("INSERT INTO habits(id,name,day,note) VALUES(?,?,?,?)").run(result.id, result.name, result.day, result.note);
        } else if (execution.capability === "habits.list") {
          if (!validObject(input, ["cursor", "limit"]) || !Number.isSafeInteger(input.cursor ?? 0) || (input.cursor ?? 0) < 0 || !Number.isSafeInteger(input.limit ?? 50) || (input.limit ?? 50) < 1 || (input.limit ?? 50) > 100) throw new Error("invalid_input");
          const limit = input.limit ?? 50;
          const rows = database.prepare("SELECT sequence,id,name,day,note FROM habits WHERE sequence>? ORDER BY sequence LIMIT ?").all(input.cursor ?? 0, limit + 1);
          partial = rows.length > limit;
          const visible = rows.slice(0, limit);
          result = { entries: visible.map(entryFrom), nextCursor: partial ? visible.at(-1).sequence : null };
        } else throw new Error("capability_unavailable");
        const outcome = MistyCapabilityOutcomeSchema.parse({ status: "success", result, partial, evidence: [{ targetId: target.id, observedAt: new Date().toISOString(), kind: "provider", reference: execution.capability === "habits.record" ? `habit:${result.id}` : `habits:after:${input.cursor ?? 0}` }] });
        database.prepare("INSERT INTO effects(id,fingerprint,outcome) VALUES(?,?,?)").run(execution.effectId, fingerprint, JSON.stringify(outcome));
        database.exec("COMMIT");
        return outcome;
      } catch (error) {
        database.exec("ROLLBACK");
        const code = ["invalid_input", "deadline_expired", "capability_unavailable"].includes(error.message) ? error.message : "storage_unavailable";
        return failure(code, "The habit action was not committed.");
      }
    },
  };
}
