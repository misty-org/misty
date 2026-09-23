import { describe, expect, it, vi } from "vitest";
import { migrateRecoveryRecord, NativeRecoveryStorage, type RecoveryPort } from "./recovery";

function fixture() {
  const records = new Map<string, { revision: number; value: string }>();
  const port: RecoveryPort = {
    read: vi.fn(async (key) => records.get(key) ?? null),
    write: vi.fn<RecoveryPort["write"]>(async (key, revision, value) => {
      const old = records.get(key);
      if (old && old.value === value) return old;
      if ((old?.revision ?? 0) !== revision) throw new Error("stale revision");
      const next = { revision: revision + 1, value };
      records.set(key, next);
      return next;
    }),
  };
  return { port, records, storage: new NativeRecoveryStorage(port) };
}
describe("native workspace recovery", () => {
  it("coalesces unsaved changes and performs no write for unchanged values", async () => {
    const f = fixture();
    await f.storage.load("workspace");
    for (let n = 0; n < 100; n++) f.storage.setItem("workspace", String(n));
    await f.storage.flush();
    expect(f.port.write).toHaveBeenCalledTimes(1);
    expect(f.records.get("workspace")?.value).toBe("99");
    f.storage.setItem("workspace", "99");
    await f.storage.flush();
    expect(f.port.write).toHaveBeenCalledTimes(1);
  });
  it("retries the exact write after a lost reply before saving newer changes", async () => {
    const f = fixture();
    const write = f.port.write;
    let lost = true;
    f.port.write = vi.fn<RecoveryPort["write"]>(async (...args) => {
      const result = await write(...args);
      if (lost) {
        lost = false;
        throw new Error("lost reply");
      }
      return result;
    });
    f.storage.setItem("workspace", "first");
    await expect(f.storage.flush()).rejects.toThrow("lost reply");
    f.storage.setItem("workspace", "latest");
    await f.storage.flush();
    expect(vi.mocked(f.port.write).mock.calls).toEqual([
      ["workspace", 0, "first"],
      ["workspace", 0, "first"],
      ["workspace", 1, "latest"],
    ]);
    expect(f.records.get("workspace")).toEqual({ revision: 2, value: "latest" });
  });
  it("preserves the exact legacy source until native archive and import commit", async () => {
    const f = fixture();
    const legacy = new Map([["old-key", "{damaged but recoverable"]]);
    const source = {
      getItem: (key: string) => legacy.get(key) ?? null,
      removeItem: (key: string) => legacy.delete(key),
    };
    const write = f.port.write;
    f.port.write = vi.fn(async () => {
      throw new Error("disk full");
    });
    await expect(
      migrateRecoveryRecord(f.storage, "workspace", source, "old-key"),
    ).rejects.toThrow();
    expect(legacy.has("old-key")).toBe(true);
    f.port.write = write;
    await migrateRecoveryRecord(f.storage, "workspace", source, "old-key");
    expect(legacy.has("old-key")).toBe(false);
    expect(f.records.get("workspace")?.value).toBe("{damaged but recoverable");
    expect([...f.records].filter(([key]) => key.startsWith("archive:"))).toHaveLength(1);
  });
  it("does not delete a concurrently changed legacy record or overwrite native state", async () => {
    const f = fixture();
    f.records.set("workspace", { revision: 1, value: "native" });
    let raw: string | null = "legacy";
    const source = {
      getItem: () => raw,
      removeItem: () => {
        raw = null;
      },
    } as unknown as Storage;
    const write = f.port.write;
    f.port.write = async (...args) => {
      raw = "changed during migration";
      return write(...args);
    };
    await expect(migrateRecoveryRecord(f.storage, "workspace", source, "old-key")).rejects.toThrow(
      "Both have been preserved",
    );
    expect(raw).toBe("changed during migration");
    expect(f.records.get("workspace")?.value).toBe("native");
  });
});
