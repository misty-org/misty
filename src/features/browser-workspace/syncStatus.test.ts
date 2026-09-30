import { describe, expect, it } from "vitest";
import { selectSyncStatus, syncIssues, type SyncStatusInput } from "./syncStatus";
import { syncSession } from "./syncTestFixtures";
const base: SyncStatusInput = {
  accountId: "a",
  session: syncSession(),
  recovery: { accountId: "a", ready: true, issue: null },
  preferences: { accountId: "a", ready: true, syncing: false, pending: 0, error: null },
};
describe("one sync status selector", () => {
  it.each(Object.keys(syncIssues))("maps %s to human copy and exactly one action", (code) => {
    const result = selectSyncStatus({ ...base, issue: code });
    expect(result).toEqual(syncIssues[code]);
    expect(result.action?.label).toBeTruthy();
    expect(result.detail).not.toContain(code);
    expect(result.detail.length).toBeGreaterThan(20);
  });
  it("always includes detail for healthy, pending and offline states", () => {
    for (const phase of [
      "ready",
      "catching_up",
      "offline",
      "connecting",
      "attention",
      "stopped",
    ] as const) {
      const view = syncSession();
      view.status.phase = phase;
      expect(selectSyncStatus({ ...base, session: view }).detail.length).toBeGreaterThan(15);
    }
    expect(selectSyncStatus(base)).toMatchObject({
      tone: "healthy",
      title: "Up to date",
      action: null,
    });
  });
  it("prioritizes local saving failure and never claims unsaved work is safe", () => {
    expect(
      selectSyncStatus({
        ...base,
        issue: "sync_device_forbidden",
        recovery: { accountId: "a", ready: false, issue: "disk" },
      }),
    ).toEqual(syncIssues.local_storage_unavailable);
    expect(
      selectSyncStatus({ ...base, recovery: { accountId: "a", ready: false, issue: null } }).title,
    ).toBe("Restoring workspace");
  });
  it("does not hide preference failures behind healthy workspace sync", () => {
    expect(
      selectSyncStatus({ ...base, preferences: { ...base.preferences!, error: "server" } }).title,
    ).toBe("Settings need attention");
    expect(
      selectSyncStatus({ ...base, preferences: { ...base.preferences!, pending: 2 } }).detail,
    ).toContain("2 changes");
  });
  it("ignores status and recovery from another account", () => {
    expect(
      selectSyncStatus({
        ...base,
        session: syncSession({ account_id: "b" }),
        recovery: { accountId: "b", ready: false, issue: "disk" },
        preferences: { ...base.preferences!, accountId: "b", error: "error" },
      }),
    ).toMatchObject({ title: "Sync is locked", action: { kind: "unlock" } });
  });
  it("distinguishes confirmed setup from unknown vault availability", () => {
    expect(
      selectSyncStatus({ ...base, session: null, vault: { remote: null, local: false } }).action
        ?.kind,
    ).toBe("unlock");
    expect(
      selectSyncStatus({ ...base, session: null, vault: { remote: false, local: false } }).action
        ?.kind,
    ).toBe("setup");
    expect(
      selectSyncStatus({ ...base, session: null, vault: { remote: true, local: true } }).detail,
    ).toContain("saved device key");
  });
  it("keeps account settings separate from independent workspace mode", () => {
    expect(
      selectSyncStatus({ ...base, session: syncSession({ full_sync: false }) }).detail,
    ).toContain("Account settings still sync");
    expect(
      selectSyncStatus({ ...base, scope: "settings", issue: "sync_device_forbidden" }).title,
    ).toBe("Settings are up to date");
  });
  it("explains unsupported sign-ins without treating them as broken", () => {
    expect(
      selectSyncStatus({ ...base, session: syncSession({ supports_cookie_handoff: false }) }),
    ).toMatchObject({ tone: "healthy", detail: expect.stringContaining("not supported") });
  });
  it("does not leak unknown protocol codes into copy", () => {
    expect(selectSyncStatus({ ...base, issue: "unexpected_internal_123" })).toMatchObject({
      title: "Sync needs attention",
      action: { kind: "retry" },
    });
    expect(selectSyncStatus({ ...base, issue: "unexpected_internal_123" }).detail).not.toContain(
      "unexpected_internal",
    );
  });
  it("directs removed devices to re-enrollment and expired accounts to sign-in", () => {
    expect(selectSyncStatus({ ...base, reenroll: true }).action?.kind).toBe("reenroll");
    expect(selectSyncStatus({ ...base, accountId: "" }).action?.kind).toBe("sign-in");
  });
});

it("does not report settings as synced before the account record has loaded", () => {
  expect(
    selectSyncStatus({ ...base, preferences: { ...base.preferences!, ready: false } }).title,
  ).toBe("Loading settings");
  expect(
    selectSyncStatus({ ...base, preferences: { ...base.preferences!, synced: false } }).title,
  ).toBe("Loading settings");
});
