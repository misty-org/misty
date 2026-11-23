import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { frozenLeave, type FrozenRoom } from "./app_file_room_leaving";
import type { FileRoomMessage } from "./app_file_room_messages";

const roomWith = (more: { lost?: boolean; linked?: boolean } = {}) => {
  const calls = { replay: 0, clear: 0, finish: 0, settle: 0 };
  const room = {
    doc: new Y.Doc(),
    hold: { active: false, release: () => {}, resendAll: () => {} },
    paused: {
      count: 1,
      lost: more.lost === true,
      replay: () => (calls.replay += 1),
      clear: () => (calls.clear += 1),
    },
    generation: () => "g1",
    linked: () => more.linked !== false,
    pause: () => ({ accepted: true, sentOn: 1 }),
    links: () => 1,
    settle: () => (calls.settle += 1),
    finish: () => (calls.finish += 1),
  };
  return { room: room as unknown as FrozenRoom, calls };
};

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

describe("an app leaving its file while the room is paused", () => {
  it("puts the held edits in when the bound passes while linked", () => {
    const { room, calls } = roomWith();
    const leave = frozenLeave(room);
    expect(leave.hold()).toBe(true);
    leave.over();
    expect(calls.replay).toBe(1);
    expect(calls.finish).toBe(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it("says the held edits weren't kept when the bound passes while the link is down", () => {
    const { room, calls } = roomWith({ linked: false });
    const leave = frozenLeave(room);
    leave.hold();
    leave.over();
    expect(calls.replay).toBe(0);
    expect(calls.clear).toBe(1);
    expect(calls.finish).toBe(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("weren't kept"));
  });

  it("says too many edits weren't kept", () => {
    const { room } = roomWith({ lost: true });
    expect(frozenLeave(room).hold()).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("weren't kept"));
  });

  it("says the held edits weren't kept when the room was opened afresh", () => {
    const { room, calls } = roomWith();
    const leave = frozenLeave(room);
    leave.hold();
    const said: FileRoomMessage = { type: "file_writer", writer: false, readOnly: false, outside: false, generation: "g2" };
    leave.heard(said);
    expect(calls.replay).toBe(0);
    expect(calls.finish).toBe(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("weren't kept"));
  });
});
