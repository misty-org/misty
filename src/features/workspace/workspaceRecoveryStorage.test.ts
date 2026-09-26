import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  browserWorkspaceStoreVersion,
  workspaceRecoveryKey,
  workspaceRecoveryStorage,
} from "./workspaceRecoveryStorage";

const name = "workspace-recovery-test";
const old = JSON.stringify({
  version: 12,
  state: { spaces: [{ id: "family", document: "Retired tab state" }] },
});
const current = JSON.stringify({
  version: browserWorkspaceStoreVersion,
  state: { tabs: ["browser"] },
});
beforeEach(() => localStorage.clear());
describe("workspace migration recovery", () => {
  it("preserves the exact original once, before reading or overwriting it", () => {
    localStorage.setItem(name, old);
    const storage = workspaceRecoveryStorage(localStorage);
    expect(storage.getItem(name)).toBe(old);
    expect(localStorage.getItem(workspaceRecoveryKey(name))).toBe(old);
    storage.setItem(name, current);
    storage.setItem(
      name,
      JSON.stringify({ version: browserWorkspaceStoreVersion, state: { tabs: [] } }),
    );
    storage.removeItem(name);
    expect(localStorage.getItem(name)).toBeNull();
    expect(localStorage.getItem(workspaceRecoveryKey(name))).toBe(old);
  });
  it("does not overwrite or remove the original if recovery storage is full", () => {
    localStorage.setItem(name, old);
    const setItem = vi.fn((key: string, value: string) => {
      if (key === workspaceRecoveryKey(name)) throw new DOMException("Full", "QuotaExceededError");
      localStorage.setItem(key, value);
    });
    const storage = workspaceRecoveryStorage({
      getItem: (key) => localStorage.getItem(key),
      setItem,
      removeItem: (key) => localStorage.removeItem(key),
    });
    expect(() => storage.getItem(name)).toThrow("Full");
    expect(() => storage.setItem(name, current)).toThrow("Full");
    expect(() => storage.removeItem(name)).toThrow("Full");
    expect(localStorage.getItem(name)).toBe(old);
  });
  it("preserves malformed historical data and skips fresh browser-workspace records", () => {
    localStorage.setItem(name, '{"version":12,"unfinished":');
    const storage = workspaceRecoveryStorage(localStorage);
    storage.setItem(name, current);
    expect(localStorage.getItem(workspaceRecoveryKey(name))).toBe('{"version":12,"unfinished":');
    const fresh = `${name}-fresh`;
    storage.setItem(fresh, current);
    storage.setItem(fresh, current);
    expect(localStorage.getItem(workspaceRecoveryKey(fresh))).toBeNull();
  });
});
