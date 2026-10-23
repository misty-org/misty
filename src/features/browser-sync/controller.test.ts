import { dockLeaves } from "@/features/workspace/dockTree";
import { describe, expect, it, vi } from "vitest";
import { canProjectWorkspace, WorkspaceSyncController } from "./controller";
import type { SharedRecord } from "./model";

import { harness, settled, storage } from "./controller.testFixtures";
describe("workspace sync controller recovery", () => {
  it("publishes a closed recovered tab before remote projection can restore it", async () => {
    const h = harness();
    const record = structuredClone(
      h.current().workspace.records.find((record) => record.kind === "view")!,
    ) as SharedRecord<"view">;
    record.id = "tab:orphan";
    record.fields.placement.pane_id = "pane:removed";
    h.current().workspace.records.push(record);
    const controller = h.start();
    try {
      await settled();
      const next = structuredClone(h.ports.source.read());
      expect(next.windows[0].layout.tabs).toHaveLength(2);
      next.windows[0].layout.tabs = next.windows[0].layout.tabs!.filter(
        (tab) => tab.id !== "recovery:tab:tab:orphan",
      );
      h.ports.publish.mockRejectedValueOnce(new Error("Temporarily offline"));
      h.ports.source.write({ ...next, folders: [], bookmarks: [], recoveryViewIds: [] });
      await settled();
      expect(h.journal.pending[0].changes).toContainEqual({
        action: "delete",
        kind: "view",
        id: "tab:orphan",
      });
      controller.refresh();
      await settled();
      expect(h.ports.source.read().windows[0].layout.tabs).toHaveLength(1);
      // Retry explicitly after connectivity returns, preserving the queued deletion.
      controller.stop();
      const resumed = h.start();
      try {
        await settled();
        expect(h.current().workspace.records.some((record) => record.id === "tab:orphan")).toBe(
          false,
        );
        expect(h.ports.source.read().windows[0].layout.tabs).toHaveLength(1);
      } finally {
        resumed.stop();
      }
    } finally {
      controller.stop();
    }
  });

  it("bounds failed edit retries while another profile keeps notifying and preserves the edit", async () => {
    vi.useFakeTimers();
    const h = harness();
    const controller = h.start();
    try {
      await settled();
      h.ports.publish.mockRejectedValue(new Error("Sync unavailable"));
      h.editTitle("Keep this local edit");
      await settled();
      expect(h.ports.publish).toHaveBeenCalledTimes(1);
      for (let i = 0; i < 50; i++) {
        controller.refresh();
        await settled();
      }
      expect(h.ports.publish).toHaveBeenCalledTimes(1);
      expect(h.title()).toBe("Keep this local edit");
      expect(h.journal.pending).toHaveLength(1);
      expect(h.ports.state).toHaveBeenLastCalledWith(expect.anything(), true);
      await vi.advanceTimersByTimeAsync(1_000);
      await settled();
      expect(h.ports.publish).toHaveBeenCalledTimes(2);
      h.ports.publish.mockImplementation(async (_session, id, changes) => h.accept(id, changes));
      await vi.advanceTimersByTimeAsync(2_000);
      await settled();
      expect(h.ports.publish).toHaveBeenCalledTimes(3);
      expect(h.journal.pending).toHaveLength(0);
      expect(h.title()).toBe("Keep this local edit");
    } finally {
      controller.stop();
      vi.useRealTimers();
    }
  });
  it("keeps an independent workspace local while receiving cloud state, then rejoins only when enabled", async () => {
    const h = harness();
    const controller = h.start();
    controller.refresh();
    await settled();
    h.current().full_sync = false;
    controller.refresh();
    await settled();
    h.editTitle("Independent local tab");
    h.current().workspace.records.find((r) => r.kind === "view")!.fields.title = "Cloud tab";
    h.current().workspace.sequence++;
    controller.refresh();
    await settled();
    expect(h.title()).toBe("Independent local tab");
    expect(h.ports.publish).not.toHaveBeenCalled();
    expect(canProjectWorkspace(h.current())).toBe(false);
    h.current().full_sync = true;
    controller.refresh();
    await settled();
    expect(h.title()).toBe("Cloud tab");
    expect(h.ports.publish).not.toHaveBeenCalled();
    await controller.stop();
  });
  it("handles control moving between the state read and native publish", async () => {
    const h = harness();
    const controller = h.start();
    await settled();
    h.ports.publish.mockImplementationOnce(async () => {
      h.current().workspace.active_device = {
        device_id: "device:b",
        epoch: "epoch:b",
        sequence: 4,
      };
      throw new Error("This device is following sync");
    });
    h.editTitle("In-flight edit");
    await settled();
    expect(h.journal.pending).toHaveLength(0);
    expect(h.ports.error).not.toHaveBeenCalled();
    controller.stop();
  });
  it("keeps this machine's selected tab when another machine focuses a different one", async () => {
    const h = harness();
    const second = structuredClone(h.current().workspace.records[2]) as SharedRecord<"view">;
    second.id = "tab:b";
    second.fields.placement = { ...second.fields.placement, order: 1 };
    h.current().workspace.records.push(second);
    const controller = h.start();
    await settled();
    const selected = () =>
      dockLeaves(h.ports.source.read().windows[0].layout.tabs![0].root)[0].activeViewId;
    expect(selected()).toBe("tab:a");
    // Another machine focuses tab:b and retitles tab:a.
    h.current().workspace.resumes = {
      "device:b": {
        sequence: 99,
        resume: {
          active_window_id: "window:a",
          active_tab_id: "layout:a",
          focused_pane_id: "pane:a",
          active_view_by_pane: { "pane:a": "tab:b" },
        },
      },
    };
    (h.current().workspace.records[2] as SharedRecord<"view">).fields.title = "Renamed elsewhere";
    h.current().workspace.sequence++;
    controller.refresh();
    await settled();
    expect(selected()).toBe("tab:a");
    expect(h.title()).toBe("Renamed elsewhere");
    controller.stop();
  });
  it("does not publish follower page-load, title, or selection changes", async () => {
    const h = harness();
    h.current().workspace.active_device!.device_id = "device:b";
    const controller = new WorkspaceSyncController(h.current(), h.ports);
    await settled();
    h.editTitle("Title reported by the follower's page load");
    await controller.flushLocal();
    await settled();
    expect(h.journal.pending).toHaveLength(0);
    expect(h.ports.publish).not.toHaveBeenCalled();
    const writes = vi.mocked(h.ports.source.write).mock.calls.length;
    h.current().workspace.sequence++;
    controller.refresh();
    await settled();
    expect(vi.mocked(h.ports.source.write).mock.calls).toHaveLength(writes);
    expect(h.title()).toBe("Title reported by the follower's page load");
    controller.stop();
  });

  it("retires queued edits when control moves away and does not replay them on takeover", async () => {
    const h = harness();
    const controller = h.start();
    await settled();
    h.editTitle("Queued under the old active selection");
    h.current().workspace.active_device = { device_id: "device:b", epoch: "epoch:b", sequence: 4 };
    await settled();
    expect(h.ports.publish).not.toHaveBeenCalled();
    expect(h.journal.pending).toHaveLength(0);
    h.current().workspace.active_device = {
      device_id: "device:a",
      epoch: "epoch:new",
      sequence: 5,
    };
    controller.refresh();
    await settled();
    expect(h.ports.publish).not.toHaveBeenCalled();
    h.editTitle("New edit after taking control");
    await settled();
    expect(h.ports.publish).toHaveBeenCalledTimes(1);
    expect(h.ports.publish.mock.calls[0]).toEqual([
      "session:a",
      expect.any(String),
      [
        {
          action: "patch",
          kind: "view",
          id: "tab:a",
          fields: { title: "New edit after taking control" },
        },
      ],
      "epoch:new",
    ]);
    controller.stop();
  });

  it("preserves an unselected new workspace until the user chooses its active device", async () => {
    const h = harness();
    h.current().workspace.records = [];
    h.current().workspace.active_device = null;
    const controller = h.start();
    await settled();
    expect(h.title()).toBe("Page");
    expect(h.ports.publish).not.toHaveBeenCalled();
    h.current().workspace.active_device = {
      device_id: "device:a",
      epoch: "epoch:first",
      sequence: 4,
    };
    controller.refresh();
    await settled();
    expect(h.ports.publish).toHaveBeenCalledTimes(1);
    expect(h.current().workspace.records.some((record) => record.id === "tab:a")).toBe(true);
    controller.stop();
  });
  it("does not publish or erase an edit until native recovery acknowledges it", async () => {
    let unavailable = true;
    const disk = {
      ...storage(),
      flush: vi.fn(async () => {
        if (unavailable) throw new Error("native disk unavailable");
      }),
    };
    const h = harness(disk);
    const controller = h.start();
    await settled();
    h.editTitle("Keep this unsaved change");
    await settled();
    expect(h.ports.publish).not.toHaveBeenCalled();
    expect(h.title()).toBe("Keep this unsaved change");
    expect(h.journal.pending).toHaveLength(1);
    unavailable = false;
    controller.refresh();
    await settled();
    expect(h.ports.publish).toHaveBeenCalledTimes(1);
    expect(h.journal.pending).toHaveLength(0);
    controller.stop();
  });
});
