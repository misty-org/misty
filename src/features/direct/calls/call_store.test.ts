import { afterEach, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ ringDm: vi.fn(() => Promise.resolve()) }));
vi.mock("../api", () => ({ directApi: api }));
const keys = vi.hoisted(() => ({
  openRingKey: vi.fn(() => Promise.resolve(new Uint8Array(32))),
  sealForDm: vi.fn(() =>
    Promise.resolve({ callKey: new Uint8Array(32), sealedKeys: {}, senderKeyId: "k1" }),
  ),
  newCallKey: vi.fn(() => new Uint8Array(32)),
}));
vi.mock("./call_keys", () => keys);
const room = vi.hoisted(() => ({
  checkCallRoom: vi.fn(() => Promise.resolve({ full: false, people: [] as string[] })),
}));
vi.mock("./call_room", () => room);
vi.mock("./call_support", () => ({ callEncryptionSupported: () => true }));
const dms = vi.hoisted(() => ({
  peekDm: vi.fn((id: string) => (id.startsWith("group") ? { id, kind: "group" } : { id, kind: "direct" })),
}));
vi.mock("../direct_data", () => dms);

import { useCallStore, voiceRoom } from "./call_store";
import { useMissedCalls } from "./missed_calls";

afterEach(() => {
  api.ringDm.mockClear();
  room.checkCallRoom.mockClear();
  keys.sealForDm.mockClear();
  useCallStore.setState({ incoming: null, active: null });
  useMissedCalls.setState({ byDm: {} });
});

const inVoice = () =>
  useCallStore
    .getState()
    .join(
      { kind: "voice", spaceId: "sp_1", channelId: "ch_1", name: "General" },
      voiceRoom("sp_1", "ch_1"),
      new Uint8Array(32),
    );

it("declining a call tells the caller, and only clears the ring here", () => {
  useCallStore.getState().ring({ dmId: "dm_1", from: "ana", video: true, sealedKeys: {} });
  useCallStore.getState().decline();
  expect(useCallStore.getState().incoming).toBeNull();
  expect(api.ringDm).toHaveBeenCalledWith("dm_1", "declined", true);
});

it("declining with nothing ringing tells no one", () => {
  useCallStore.getState().decline();
  expect(api.ringDm).not.toHaveBeenCalled();
});

it("leaving a call nobody answered stops it ringing for the others", () => {
  useCallStore.setState({
    active: {
      place: { kind: "dm", dmId: "dm_2" },
      room: "dm:dm_2",
      video: false,
      key: new Uint8Array(32),
      state: "connecting",
      caller: true,
      answered: false,
    } as never,
  });
  useCallStore.getState().leave();
  expect(useCallStore.getState().active).toBeNull();
  expect(api.ringDm).toHaveBeenCalledWith("dm_2", "ended", false);
});

it("joins a voice channel's room with the key it holds, and leaving rings no one", () => {
  const key = new Uint8Array(32);
  const place = { kind: "voice", spaceId: "sp_1", channelId: "ch_1", name: "General" } as const;
  useCallStore.getState().join(place, voiceRoom("sp_1", "ch_1"), key);
  const active = useCallStore.getState().active;
  expect(active?.room).toBe("space:sp_1:voice:ch_1");
  expect(active?.place).toEqual(place);
  expect(active?.answered).toBe(true);
  useCallStore.getState().leave();
  expect(useCallStore.getState().active).toBeNull();
  expect(api.ringDm).not.toHaveBeenCalled();
});

it("joins nothing while already in a call", () => {
  useCallStore
    .getState()
    .join(
      { kind: "voice", spaceId: "sp_1", channelId: "ch_1", name: "General" },
      voiceRoom("sp_1", "ch_1"),
      new Uint8Array(32),
    );
  useCallStore
    .getState()
    .join(
      { kind: "voice", spaceId: "sp_1", channelId: "ch_2", name: "Music" },
      voiceRoom("sp_1", "ch_2"),
      new Uint8Array(32),
    );
  expect(useCallStore.getState().active?.room).toBe("space:sp_1:voice:ch_1");
});

it("tells a caller I'm busy while I'm in another call, and counts it as missed", () => {
  inVoice();
  useCallStore.getState().ring({ dmId: "dm_3", from: "ana", video: false, sealedKeys: {} });
  expect(useCallStore.getState().incoming).toBeNull();
  expect(api.ringDm).toHaveBeenCalledWith("dm_3", "busy", false);
  expect(useMissedCalls.getState().byDm.dm_3?.from).toBe("ana");
});

it("a ring that gives way to another, or that its caller ends, is missed", () => {
  useCallStore.getState().ring({ dmId: "dm_4", from: "ana", video: false, sealedKeys: {} });
  useCallStore.getState().ring({ dmId: "dm_5", from: "ben", video: true, sealedKeys: {} });
  expect(useMissedCalls.getState().byDm.dm_4?.from).toBe("ana");
  useCallStore.getState().ringEnded("dm_5", "ana");
  expect(useCallStore.getState().incoming?.dmId).toBe("dm_5");
  useCallStore.getState().ringEnded("dm_5", "ben");
  expect(useCallStore.getState().incoming).toBeNull();
  expect(useMissedCalls.getState().byDm.dm_5?.video).toBe(true);
});

it("a ring answered in another window stops here without counting as missed", () => {
  useCallStore.getState().ring({ dmId: "dm_6", from: "ana", video: false, sealedKeys: {} });
  useCallStore.getState().answeredElsewhere("dm_6");
  expect(useCallStore.getState().incoming).toBeNull();
  expect(useMissedCalls.getState().byDm.dm_6).toBeUndefined();
});

it("accepting tells the others it was answered and joins the call's room", async () => {
  useCallStore.getState().ring({ dmId: "dm_7", from: "ana", video: true, sealedKeys: { k: "s" } });
  await useCallStore.getState().accept();
  expect(api.ringDm).toHaveBeenCalledWith("dm_7", "answered", true);
  expect(useCallStore.getState().active?.room).toBe("dm:dm_7");
});

it("doesn't join a call its caller ended while it was being opened", async () => {
  let open = (_key: Uint8Array) => undefined as void;
  keys.openRingKey.mockImplementationOnce(
    () => new Promise<Uint8Array>((resolve) => (open = resolve)) as never,
  );
  useCallStore.getState().ring({ dmId: "dm_8", from: "ana", video: false, sealedKeys: {} });
  const accepting = useCallStore.getState().accept();
  useCallStore.getState().ringEnded("dm_8", "ana");
  open(new Uint8Array(32));
  await accepting;
  expect(useCallStore.getState().active).toBeNull();
  expect(api.ringDm).not.toHaveBeenCalledWith("dm_8", "answered", false);
});

it("joins a group call already going on without ringing anyone", async () => {
  room.checkCallRoom.mockResolvedValueOnce({ full: false, people: ["ana"] });
  await useCallStore.getState().start("group_9", false);
  const active = useCallStore.getState().active;
  expect(active?.room).toBe("dm:group_9");
  expect(active?.caller).toBe(false);
  expect(api.ringDm).not.toHaveBeenCalledWith("group_9", "ringing", false, {}, "k1");
  expect(api.ringDm).toHaveBeenCalledWith("group_9", "answered", false);
  expect(keys.sealForDm).not.toHaveBeenCalled();
});

it("a one-to-one call rings even when someone seems to be in it already", async () => {
  room.checkCallRoom.mockResolvedValueOnce({ full: false, people: ["ana"] });
  await useCallStore.getState().start("dm_9b", false);
  expect(api.ringDm).toHaveBeenCalledWith("dm_9b", "ringing", false, {}, "k1");
  expect(useCallStore.getState().active?.caller).toBe(true);
});

it("starting the same call twice rings once and never ends its own ring", async () => {
  const first = useCallStore.getState().start("dm_11", false);
  const second = useCallStore.getState().start("dm_11", false);
  await Promise.all([first, second]);
  const rings = api.ringDm.mock.calls.filter((call) => (call as unknown[])[0] === "dm_11");
  expect(rings.map((call) => (call as unknown[])[1])).toEqual(["ringing"]);
  expect(useCallStore.getState().active?.caller).toBe(true);
});

it("leaves a call whose caller hung up before it connected", async () => {
  useCallStore.getState().ring({ dmId: "dm_12", from: "ana", video: false, sealedKeys: {} });
  await useCallStore.getState().accept();
  expect(useCallStore.getState().active?.state).toBe("connecting");
  useCallStore.getState().ringEnded("dm_12", "ana");
  expect(useCallStore.getState().active).toBeNull();
});

it("a ring that arrives while accepting another is answered busy once the call starts", async () => {
  let open = (_key: Uint8Array) => undefined as void;
  keys.openRingKey.mockImplementationOnce(
    () => new Promise<Uint8Array>((resolve) => (open = resolve)) as never,
  );
  useCallStore.getState().ring({ dmId: "dm_13", from: "ana", video: false, sealedKeys: {} });
  const accepting = useCallStore.getState().accept();
  useCallStore.getState().ring({ dmId: "dm_14", from: "ben", video: true, sealedKeys: {} });
  open(new Uint8Array(32));
  await accepting;
  expect(useCallStore.getState().active?.room).toBe("dm:dm_13");
  expect(useCallStore.getState().incoming).toBeNull();
  expect(api.ringDm).toHaveBeenCalledWith("dm_14", "busy", true);
  expect(useMissedCalls.getState().byDm.dm_14?.from).toBe("ben");
});

it("a key that can't be opened joins nothing", async () => {
  keys.openRingKey.mockImplementationOnce(() => Promise.reject(new Error("OperationError")) as never);
  useCallStore.getState().ring({ dmId: "dm_15", from: "ana", video: false, sealedKeys: {} });
  await useCallStore.getState().accept();
  expect(useCallStore.getState().active).toBeNull();
  expect(api.ringDm).not.toHaveBeenCalledWith("dm_15", "answered", false);
});

it("calling someone who is already calling me answers their call", async () => {
  useCallStore.getState().ring({ dmId: "dm_10", from: "ana", video: false, sealedKeys: {} });
  await useCallStore.getState().start("dm_10", false);
  expect(api.ringDm).toHaveBeenCalledWith("dm_10", "answered", false);
  expect(api.ringDm).not.toHaveBeenCalledWith("dm_10", "ringing", false, {}, "k1");
  expect(useCallStore.getState().active?.caller).toBe(false);
});
