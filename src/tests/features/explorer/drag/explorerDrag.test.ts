import { describe, expect, it } from "vitest";
import type { FileEntry } from "@/models/interfaces/services/misty-api";
import {
  dragItemsForEntry,
  transferDropAcceptance,
} from "@/features/explorer/components/FileBrowserDrag";
import {
  edgeScrollDelta,
  pathContainsPath,
  physicalToClientPoint,
  selectDropCandidate,
} from "@/features/explorer/drag/geometry";
import {
  groupItemsByOperation,
  invalidTransferReason,
  operationForInternalDrop,
  storageIdForPath,
} from "@/features/explorer/drag/operations";
import type {
  ExplorerDragItem,
  ExplorerDragPayload,
} from "@/models/interfaces/features/explorer/drag/types";

describe("Explorer pointer drag geometry", () => {
  it("converts Tauri physical coordinates through DPI and app zoom", () => {
    expect(physicalToClientPoint({ x: 600, y: 300 }, 2, 1)).toEqual({ x: 300, y: 150 });
    expect(physicalToClientPoint({ x: 600, y: 300 }, 2, 0.5)).toEqual({ x: 600, y: 300 });
    expect(physicalToClientPoint({ x: 600, y: 300 }, 1.5, 2)).toEqual({ x: 200, y: 100 });
    expect(physicalToClientPoint({ x: 20, y: 10 }, 0, Number.NaN)).toEqual({ x: 20, y: 10 });
  });

  it("selects higher-priority nested zones, then the deepest equal-priority zone", () => {
    expect(
      selectDropCandidate([
        { id: "pane", priority: 10, depth: 0 },
        { id: "folder", priority: 20, depth: 3 },
      ])?.id,
    ).toBe("folder");
    expect(
      selectDropCandidate([
        { id: "outer", priority: 20, depth: 4 },
        { id: "inner", priority: 20, depth: 1 },
      ])?.id,
    ).toBe("inner");
  });

  it("activates bounded edge scrolling only inside the 32px edge", () => {
    expect(edgeScrollDelta(131, 100, 500, 32)).toBeLessThan(0);
    expect(edgeScrollDelta(132, 100, 500, 32)).toBe(0);
    expect(edgeScrollDelta(469, 100, 500, 32)).toBeGreaterThan(0);
    expect(Math.abs(edgeScrollDelta(90, 100, 500, 32))).toBeLessThanOrEqual(18);
  });
});

describe("Explorer drag payload and operation rules", () => {
  it("preserves a selected multi-item payload and excludes deleted entries", () => {
    const first = entry("a", "/Users/me/A.txt");
    const second = entry("b", "/Users/me/B.txt");
    const deleted = { ...entry("c", "/Users/me/C.txt"), isDeleted: true };
    expect(
      dragItemsForEntry(first, [first, second, deleted], new Set(["a", "b", "c"])).map(
        (item) => item.entryId,
      ),
    ).toEqual(["a", "b"]);
    expect(
      dragItemsForEntry(second, [first, second], new Set(["a"])).map((item) => item.entryId),
    ).toEqual(["b"]);
    expect(dragItemsForEntry(deleted, [deleted], new Set(["c"]))).toEqual([]);
  });

  it("derives stable storage identities and honors copy modifiers", () => {
    expect(storageIdForPath("/Volumes/Photos/a.jpg", null)).toBe("volume:Photos");
    expect(storageIdForPath("/mnt/misty/work/a.jpg", "work")).toBe("remote:work");
    expect(
      storageIdForPath("/media/card/a.jpg", null, [{ id: "card", mountPath: "/media/card" }]),
    ).toBe("device:card");
    const item = dragItem("/Volumes/Photos/a.jpg", false, "volume:Photos");
    expect(operationForInternalDrop(item, "volume:Photos", false)).toBe("move");
    expect(operationForInternalDrop(item, "volume:Photos", true)).toBe("copy");
    expect(operationForInternalDrop(item, "remote:work", false)).toBe("copy");
  });

  it("groups mixed selections and rejects self, parent no-op, and descendant drops", () => {
    const local = dragItem("/Volumes/Photos/a.jpg", false, "volume:Photos");
    const remote = dragItem("/mnt/misty/work/b.jpg", false, "remote:work");
    const groups = groupItemsByOperation([local, remote], "volume:Photos", false);
    expect(groups.move).toEqual([local]);
    expect(groups.copy).toEqual([remote]);
    expect(invalidTransferReason([local], "/Volumes/Photos")).toMatch(/already/);
    expect(
      invalidTransferReason([dragItem("/Users/me/Folder", true)], "/Users/me/Folder/Child"),
    ).toMatch(/itself/);
    expect(pathContainsPath("/Users/me/Folder", "/Users/me/Folderish")).toBe(false);
  });

  it("keeps invalid nested targets invalid instead of falling through", () => {
    const payload: ExplorerDragPayload = {
      sessionId: "drag",
      origin: "internal",
      items: [dragItem("/tmp/a.txt", false)],
    };
    expect(transferDropAcceptance(payload, "/tmp/file.txt", { folder: false })).toMatchObject({
      valid: false,
    });
    expect(transferDropAcceptance(payload, "/tmp/readonly", { writable: false })).toMatchObject({
      valid: false,
    });
  });
});

function dragItem(
  path: string,
  isDirectory: boolean,
  storageId = "local:default",
): ExplorerDragItem {
  return { entryId: path, name: path.split("/").pop() ?? path, path, isDirectory, storageId };
}

function entry(id: string, path: string): FileEntry {
  return {
    id,
    name: path.split("/").pop() ?? path,
    path,
    extension: ".txt",
    mimeType: "text/plain",
    remoteModified: null,
    kind: "file",
    sizeBytes: 1,
    modifiedMs: 1,
    createdMs: 1,
    readonly: false,
    hidden: false,
    location: { kind: "local", providerType: null, remoteName: null, remotePath: null },
  };
}
