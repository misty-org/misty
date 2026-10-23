import { describe, expect, it, vi } from "vitest";
import { canProjectWorkspace, WorkspaceSyncController } from "./controller";
import { EditJournal } from "./editJournal";
import type { NativeSyncView } from "./native";

import { deferred, harness, native, settled, storage } from "./controller.testFixtures";
describe("workspace sync controller capture", () => {
  it("coalesces rapid edits, protects them from remote projection, and flushes on account handoff", async () => {
    vi.useFakeTimers();
    const h = harness();
    const controller = new WorkspaceSyncController(h.current(), {
      ...h.ports,
      captureDelayMs: 400,
    });
    try {
      await settled();
      for (let i = 0; i < 50; i++) h.editTitle(`Edit ${i}`);
      controller.refresh();
      await settled();
      expect(h.title()).toBe("Edit 49");
      expect(h.ports.publish).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(400);
      await settled();
      expect(h.ports.publish).toHaveBeenCalledTimes(1);
      expect(h.ports.publish.mock.calls[0][2][0]).toMatchObject({ fields: { title: "Edit 49" } });
      h.editTitle("Before switching accounts");
      await controller.flushLocal();
      await settled();
      expect(h.ports.publish).toHaveBeenCalledTimes(2);
    } finally {
      controller.stop();
      vi.useRealTimers();
    }
  });

  it("bounds capture delay during continuous activity", async () => {
    vi.useFakeTimers();
    const h = harness();
    const controller = new WorkspaceSyncController(h.current(), {
      ...h.ports,
      captureDelayMs: 400,
    });
    try {
      await settled();
      for (let i = 0; i < 10; i++) {
        h.editTitle(`Moving ${i}`);
        await vi.advanceTimersByTimeAsync(200);
      }
      await settled();
      expect(h.ports.publish).toHaveBeenCalledTimes(1);
      expect(h.ports.publish.mock.calls[0][2][0]).toMatchObject({ fields: { title: "Moving 9" } });
    } finally {
      controller.stop();
      vi.useRealTimers();
    }
  });

  it("does not echo projections and only captures the user's changed field", async () => {
    const h = harness();
    const controller = h.start();
    await settled();
    expect(h.ports.publish).not.toHaveBeenCalled();
    h.editTitle("Edited here");
    await settled();
    expect(h.ports.publish).toHaveBeenCalledTimes(1);
    expect(h.ports.publish.mock.calls[0][2]).toEqual([
      { action: "patch", kind: "view", id: "tab:a", fields: { title: "Edited here" } },
    ]);
    controller.refresh();
    await settled();
    expect(h.ports.publish).toHaveBeenCalledTimes(1);
    expect(h.title()).toBe("Edited here");
    controller.stop();
  });

  it("merges group field edits without echoing received navigation records", async () => {
    const h = harness();
    h.current().workspace.records.push({
      kind: "folder",
      id: "group:a",
      fields: { label: "Reading", icon: "library", order: 0, hidden: false },
    });
    const controller = h.start();
    await settled();
    expect(h.ports.publish).not.toHaveBeenCalled();
    const source = h.ports.source.read();
    h.ports.source.write({
      ...source,
      activeWindowId: source.activeWindowId,
      folders: source.folders!.map((group) => ({
        ...group,
        fields: { ...group.fields, label: "Research" },
      })),
      bookmarks: [],
      recoveryViewIds: [],
    });
    await settled();
    expect(h.ports.publish.mock.calls[0][2]).toEqual([
      { action: "patch", kind: "folder", id: "group:a", fields: { label: "Research" } },
    ]);
    controller.refresh();
    await settled();
    expect(h.ports.publish).toHaveBeenCalledTimes(1);
    controller.stop();
  });

  it("keeps edits made while a native publish is waiting, in FIFO order", async () => {
    const h = harness();
    const controller = h.start();
    await settled();
    const ack = deferred<string>();
    h.ports.publish.mockImplementationOnce((_session, id, changes) => {
      h.accept(id, changes);
      return ack.promise;
    });
    h.editTitle("First");
    await settled();
    const firstId = h.journal.pending[0].id;
    h.editTitle("Second");
    await settled();
    expect(h.journal.pending).toHaveLength(2);
    ack.resolve(firstId);
    await settled();
    expect(h.title()).toBe("Second");
    expect(h.journal.pending).toHaveLength(0);
    expect(h.ports.publish).toHaveBeenCalledTimes(2);
    controller.stop();
  });

  it("replays the same intent after a lost native reply and renderer restart", async () => {
    const disk = storage();
    const h = harness(disk);
    let controller = h.start();
    await settled();
    h.ports.publish.mockImplementationOnce(async (_session, id, changes) => {
      h.accept(id, changes);
      throw new Error("IPC reply lost");
    });
    h.editTitle("Saved natively");
    await settled();
    const id = h.journal.pending[0].id;
    controller.stop();
    h.ports.journal = new EditJournal(disk, h.current());
    controller = h.start();
    await settled();
    expect(h.ports.publish.mock.calls.map((call) => call[1])).toEqual([id, id]);
    expect(h.applied.size).toBe(1);
    expect(h.ports.journal.pending).toHaveLength(0);
    expect(h.title()).toBe("Saved natively");
    controller.stop();
  });

  it("does not overwrite a visible edit when journaling fails during an in-flight read", async () => {
    const disk = storage();
    const h = harness(disk);
    const controller = h.start();
    await settled();
    const read = deferred<NativeSyncView>();
    h.ports.read.mockImplementationOnce(() => read.promise);
    controller.refresh();
    disk.setItem.mockImplementationOnce(() => {
      throw new Error("Disk full");
    });
    h.editTitle("Must survive");
    read.resolve(structuredClone(h.current()));
    await settled();
    expect(h.title()).toBe("Must survive");
    expect(h.ports.publish).not.toHaveBeenCalled();
    expect(h.ports.error).toHaveBeenCalled();
    controller.refresh();
    await settled();
    expect(h.title()).toBe("Must survive");
    expect(h.ports.publish).toHaveBeenCalledTimes(1);
    controller.stop();
  });

  it("reads again when another native event arrives during a read", async () => {
    const h = harness();
    const controller = h.start();
    await settled();
    const read = deferred<NativeSyncView>();
    const started = deferred<void>();
    const stale = structuredClone(h.current());
    h.ports.read.mockImplementationOnce(() => {
      started.resolve();
      return read.promise;
    });
    controller.refresh();
    await started.promise;
    const tab = h.current().workspace.records.find((record) => record.kind === "view")!;
    tab.fields.title = "Remote change";
    controller.refresh();
    read.resolve(stale);
    await settled();
    expect(h.title()).toBe("Remote change");
    expect(h.ports.publish).not.toHaveBeenCalled();
    controller.stop();
  });

  it("does not project or acknowledge late replies after account teardown", async () => {
    const h = harness();
    const controller = h.start();
    await settled();
    const ack = deferred<string>();
    h.ports.publish.mockImplementationOnce((_session, id, changes) => {
      h.accept(id, changes);
      return ack.promise;
    });
    h.editTitle("Old account edit");
    await settled();
    const id = h.journal.pending[0].id;
    controller.stop();
    const writes = vi.mocked(h.ports.source.write).mock.calls.length;
    ack.resolve(id);
    await settled();
    expect(h.journal.pending[0].id).toBe(id);
    expect(vi.mocked(h.ports.source.write).mock.calls).toHaveLength(writes);
    expect(h.ports.closed).toHaveBeenCalledTimes(1);
  });

  it("journals edits while locked and merges them before the unlock projection", async () => {
    const h = harness();
    const controller = h.start();
    await settled();
    const resumed = structuredClone(h.current());
    resumed.session_id = "session:unlocked";
    const remoteTab = resumed.workspace.records.find((record) => record.kind === "view")!;
    remoteTab.fields.url = "https://changed-remotely.test";
    h.lock();
    controller.refresh();
    await settled();
    h.editTitle("Local after lock");
    await settled();
    expect(h.ports.locked).toHaveBeenCalled();
    expect(h.ports.closed).not.toHaveBeenCalled();
    expect(h.ports.publish).not.toHaveBeenCalled();
    const pending = structuredClone(h.journal.pending);
    expect(pending).toHaveLength(1);
    h.unlock(resumed);
    controller.refresh();
    await settled();
    expect(h.ports.publish).toHaveBeenCalledExactlyOnceWith(
      "session:unlocked",
      pending[0].id,
      [{ action: "patch", kind: "view", id: "tab:a", fields: { title: "Local after lock" } }],
      "epoch:a",
    );
    expect(h.title()).toBe("Local after lock");
    expect(h.current().workspace.records.find((record) => record.kind === "view")?.fields.url).toBe(
      "https://changed-remotely.test",
    );
    expect(h.journal.pending).toHaveLength(0);
    controller.stop();
  });

  it("retains captured locked edits through renderer restart using the same intent ID", async () => {
    const disk = storage();
    const h = harness(disk);
    let controller = h.start();
    await settled();
    const resumed = structuredClone(h.current());
    h.lock();
    controller.refresh();
    await settled();
    h.editTitle("Saved during lock");
    await settled();
    const id = h.journal.pending[0].id;
    controller.stop();
    h.unlock(resumed);
    h.ports.journal = new EditJournal(disk, resumed);
    controller = h.start();
    await settled();
    expect(h.ports.publish.mock.calls.map((call) => call[1])).toEqual([id]);
    expect(h.title()).toBe("Saved during lock");
    controller.stop();
  });
});

describe("initial workspace replay gate", () => {
  it("never seeds from an unverified empty snapshot or a partially replayed first workspace", () => {
    const view = native();
    view.workspace.records = [];
    view.workspace.sequence = 0;
    view.status.applied_sequence = 0;
    view.status.head_sequence = 0;
    view.status.phase = "connecting";
    expect(canProjectWorkspace(view)).toBe(false);
    view.status.phase = "offline";
    expect(canProjectWorkspace(view)).toBe(false);
    view.status.phase = "catching_up";
    view.status.head_sequence = 10;
    expect(canProjectWorkspace(view)).toBe(false);
    view.status.head_sequence = 0;
    expect(canProjectWorkspace(view)).toBe(true);
  });
  it("allows an existing document or native outbox to reopen offline", () => {
    const view = native();
    view.status.phase = "offline";
    expect(canProjectWorkspace(view)).toBe(true);
    view.workspace.sequence = 0;
    view.pending_operation_ids = ["queued"];
    expect(canProjectWorkspace(view)).toBe(true);
  });
});
