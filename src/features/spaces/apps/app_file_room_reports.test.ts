import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { savedReports, type SavedReportLink } from "./app_file_room_reports";
import { snapshotOf } from "./app_file_room_marks";

beforeEach(() => vi.stubGlobal("crypto", webcrypto));
afterEach(() => vi.unstubAllGlobals());

function reports(link: SavedReportLink) {
  const sent: Record<string, unknown>[] = [];
  let settled = 0;
  const saves = savedReports({
    versioned: true,
    send: (message) => {
      sent.push(JSON.parse(message) as Record<string, unknown>);
      return true;
    },
    link: () => link,
    alive: () => true,
    settle: () => {
      settled += 1;
    },
  });
  return { saves, sent, settled: () => settled };
}

describe("saved reports", () => {
  it("still sends a save's report when a rename raised the room's base past it while the room is dirty", async () => {
    const link: SavedReportLink = { links: 1, confirmedLink: 0, serverBase: 5, serverDirty: false };
    const { saves, sent, settled } = reports(link);
    const doc = new Y.Doc();
    doc.getMap("content").set("value", 1);
    saves.report(snapshotOf(doc), Y.encodeStateVector(doc), 6);
    await vi.waitFor(() => expect(settled()).toBeGreaterThan(0));
    expect(sent).toHaveLength(0);
    Object.assign(link, { confirmedLink: 1, serverBase: 7, serverDirty: true });
    saves.send();
    expect(sent).toEqual([expect.objectContaining({ type: "file_saved", version: 6, fingerprint: expect.any(String) })]);
    expect(saves.busy).toBe(false);
  });

  it("takes a save as confirmed without sending it once the base covers it and the room is clean", async () => {
    const link: SavedReportLink = { links: 1, confirmedLink: 0, serverBase: 5, serverDirty: false };
    const { saves, sent, settled } = reports(link);
    const doc = new Y.Doc();
    doc.getMap("content").set("value", 1);
    saves.report(snapshotOf(doc), Y.encodeStateVector(doc), 6);
    await vi.waitFor(() => expect(settled()).toBeGreaterThan(0));
    Object.assign(link, { confirmedLink: 1, serverBase: 6, serverDirty: false });
    saves.send();
    expect(sent).toHaveLength(0);
    expect(saves.busy).toBe(false);
  });
});
