import { describe, expect, it } from "vitest";
import type { DriveEntry } from "../drive/drive_native";
import { renameFloor, renameOf, renamesSince } from "./app_file_room_renames";

const entry = (version: number, name = "a.bin", size = 3) =>
  ({ id: "file-1", kind: "file", name, path: `/${name}`, version, size, state: "downloaded" }) as unknown as DriveEntry;

function floor(start: { base: number; serverBase?: number }) {
  const state = { ...start, links: 1 };
  const sent: number[] = [];
  const renames = renameFloor({
    base: () => state.base,
    serverBase: () => state.serverBase,
    links: () => state.links,
    send: (version) => {
      sent.push(version);
      return true;
    },
  });
  return { state, sent, renames };
}

describe("rename floor", () => {
  it("takes only a same-sized change of name or folder for a rename", () => {
    expect(renameOf(entry(5), entry(6, "b.bin"))).toEqual({ from: 5, to: 6 });
    expect(renameOf(entry(5), entry(6))).toBeNull();
    expect(renameOf(entry(5), entry(6, "b.bin", 4))).toBeNull();
    expect(renameOf(entry(6), entry(6, "b.bin"))).toBeNull();
  });

  it("takes only a change whose time stayed for a rename, and one that kept its name only at the next version", () => {
    const timed = (version: number, name = "a.bin", mtime = 100) => ({ ...entry(version, name), mtime_ms: mtime }) as DriveEntry;
    expect(renameOf(timed(5), timed(6, "b.bin"))).toEqual({ from: 5, to: 6 });
    expect(renameOf(timed(5), timed(6))).toEqual({ from: 5, to: 6 });
    expect(renameOf(timed(5), timed(7))).toBeNull();
    expect(renameOf(timed(5), timed(6, "b.bin", 200))).toBeNull();
    expect(renameOf(timed(5), timed(6, "a.bin", 200))).toBeNull();
    expect(renameOf(entry(5), timed(6))).toBeNull();
  });

  it("takes a rename only between entries that settled on the server", () => {
    const uploading = { ...entry(6, "b.bin"), state: "uploading" } as DriveEntry;
    expect(renameOf(entry(5), uploading)).toBeNull();
    expect(renameOf({ ...entry(5), state: "not_synced" } as DriveEntry, entry(6, "b.bin"))).toBeNull();
  });

  it("compares each change with the last entry that settled, never one still uploading", () => {
    const timed = (version: number, name = "a.bin", mtime = 100, state = "downloaded") =>
      ({ ...entry(version, name), mtime_ms: mtime, state }) as DriveEntry;
    const since = renamesSince(timed(5));
    expect(since(timed(5, "a.bin", 200, "uploading"))).toBeNull();
    expect(since(timed(6, "a.bin", 200))).toBeNull();
    expect(since(timed(7, "b.bin", 200))).toEqual({ from: 6, to: 7 });
    expect(since(timed(6, "c.bin", 200))).toBeNull();
    expect(since(timed(8, "c.bin", 200))).toEqual({ from: 7, to: 8 });
  });

  it("takes a rename made on this computer, named at its old version first, for a rename once the server counts it", () => {
    const timed = (version: number, name = "a.bin", mtime = 100) => ({ ...entry(version, name), mtime_ms: mtime }) as DriveEntry;
    const since = renamesSince(timed(5));
    expect(since(timed(5, "b.bin"))).toBeNull();
    expect(since(timed(5, "c.bin"))).toBeNull();
    expect(since(timed(6, "c.bin"))).toEqual({ from: 5, to: 6 });
    expect(since(timed(7, "c.bin", 300))).toBeNull();
  });

  it("takes the time a same-version entry under the same name brings, so a rename after an unchanged save is a rename", () => {
    const timed = (version: number, name = "a.bin", mtime = 100) => ({ ...entry(version, name), mtime_ms: mtime }) as DriveEntry;
    const since = renamesSince(timed(5));
    expect(since(timed(5, "a.bin", 200))).toBeNull();
    expect(since(timed(5, "b.bin", 200))).toBeNull();
    expect(since(timed(6, "b.bin", 200))).toEqual({ from: 5, to: 6 });
  });

  it("takes the next version under the same name and time for a rename that settled before it opened", () => {
    const timed = (version: number, name = "a.bin", mtime = 100) => ({ ...entry(version, name), mtime_ms: mtime }) as DriveEntry;
    expect(renamesSince(timed(5, "b.bin"))(timed(6, "b.bin"))).toEqual({ from: 5, to: 6 });
    expect(renamesSince(timed(5, "b.bin"))(timed(6, "b.bin", 200))).toBeNull();
    expect(renamesSince(timed(5, "b.bin"))(timed(7, "b.bin"))).toBeNull();
    expect(renamesSince(entry(5, "b.bin"))(entry(6, "b.bin"))).toBeNull();
  });

  it("counts a rename over the known version at once and tells the room", () => {
    const { renames, sent } = floor({ base: 5, serverBase: 5 });
    renames.note({ from: 5, to: 6 });
    expect(renames.known()).toBe(6);
    expect(sent).toEqual([6]);
  });

  it("waits for the base to reach a rename's version before counting it, then counts the chain", () => {
    const { renames, sent, state } = floor({ base: 5, serverBase: 5 });
    renames.note({ from: 6, to: 7 });
    renames.note({ from: 7, to: 8 });
    expect(renames.known()).toBe(5);
    expect(renames.content(8)).toBe(6);
    expect(sent).toEqual([]);
    state.base = 6;
    state.serverBase = 6;
    renames.tell();
    expect(renames.known()).toBe(8);
    expect(sent).toEqual([8]);
  });

  it("tells the room once per link until its base covers the rename", () => {
    const { renames, sent, state } = floor({ base: 5, serverBase: 5 });
    renames.note({ from: 5, to: 6 });
    renames.tell();
    expect(sent).toEqual([6]);
    state.links = 2;
    renames.tell();
    expect(sent).toEqual([6, 6]);
    state.serverBase = 6;
    state.links = 3;
    renames.tell();
    expect(sent).toEqual([6, 6]);
  });

  it("counts a rename the room says it heard without raising the base, and stops telling it", () => {
    const { renames, sent, state } = floor({ base: 5, serverBase: 5 });
    renames.heard(7);
    expect(renames.known()).toBe(7);
    expect(state.base).toBe(5);
    renames.note({ from: 5, to: 6 });
    state.links = 2;
    renames.tell();
    expect(sent).toEqual([]);
    renames.note({ from: 7, to: 8 });
    expect(sent).toEqual([8]);
  });
});
