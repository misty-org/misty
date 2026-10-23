import { describe, expect, it } from "vitest";
import { selectSyncStatus, syncIssues, type SyncStatusInput } from "./syncStatus";
import { syncSession } from "./syncStatus.testFixtures";
const base: SyncStatusInput = {
  accountId: "a",
  desktop: true,
  session: syncSession(),
  recovery: { accountId: "a", ready: true, issue: null },
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
    ).toMatchObject({ tone: "attention", title: "Saving on this device is paused" });
    const refused = { pending: [], failed: [{ key: "workspace", error: "too large" }] };
    expect(
      selectSyncStatus({
        ...base,
        recovery: { accountId: "a", ready: false, issue: null, saves: refused },
      }),
    ).toMatchObject({ tone: "attention", title: "Some changes are not saved on this device" });
  });
  it("reports tabs that did not come back and saves still waiting, item by item", () => {
    const recovery = { accountId: "a", ready: true, issue: null };
    expect(
      selectSyncStatus({
        ...base,
        recovery: { ...recovery, notRestored: [{ id: "v", title: "Docs", reason: "bad" }] },
      }),
    ).toMatchObject({ tone: "neutral", title: "Some tabs were not restored" });
    expect(
      selectSyncStatus({
        ...base,
        recovery: { ...recovery, saves: { pending: ["workspace"], failed: [] } },
      }).title,
    ).toBe("Saving on this device");
    expect(
      selectSyncStatus({ ...base, recovery: { accountId: "a", ready: false, issue: null } }).title,
    ).toBe("Restoring workspace");
  });
  it("ignores status and recovery from another account", () => {
    expect(
      selectSyncStatus({
        ...base,
        session: syncSession({ account_id: "b" }),
        recovery: { accountId: "b", ready: false, issue: "disk" },
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
  it("describes an independent workspace as staying on this device", () => {
    const status = selectSyncStatus({ ...base, session: syncSession({ full_sync: false }) });
    expect(status.title).toBe("Independent workspace");
    expect(status.detail).toContain("stay here");
    expect(status.detail).not.toMatch(/settings/i);
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

it("offers Sync now while batched workspace edits wait to be sent", () => {
  const waiting = syncSession();
  waiting.sync = { pending: ["workspace"] } as unknown as typeof waiting.sync;
  expect(selectSyncStatus({ ...base, session: waiting })).toMatchObject({
    tone: "neutral",
    title: "Syncing",
    action: { kind: "sync-now", label: "Sync now" },
  });
  waiting.status.phase = "offline";
  expect(selectSyncStatus({ ...base, session: waiting }).action?.kind).toBe("retry");
});

it("shows one account state and names a Space only when its vault has the problem", () => {
  const issue = "Sync stopped for this Space. Retry to reconnect it.";
  const view = { ...syncSession(), space_problems: [{ space_id: "s1", issue }] };
  expect(selectSyncStatus({ ...base, session: view, spaceNames: { s1: "Studio" } })).toMatchObject({
    tone: "attention",
    title: "Studio needs attention",
    detail: issue,
    action: { kind: "retry" },
  });
  // An account-wide problem is the account's, whichever Space also struggles.
  expect(
    selectSyncStatus({
      ...base,
      session: view,
      issue: "sign_in_required",
      spaceNames: { s1: "Studio" },
    }).title,
  ).toBe(syncIssues.sign_in_required.title);
  expect(selectSyncStatus(base).title).toBe("Up to date");
});
