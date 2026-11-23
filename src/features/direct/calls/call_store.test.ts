import { afterEach, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ ringDm: vi.fn(() => Promise.resolve()) }));
vi.mock("../api", () => ({ directApi: api }));
vi.mock("./call_keys", () => ({ openRingKey: vi.fn(), sealForDm: vi.fn() }));
vi.mock("livekit-client", () => ({ isE2EESupported: () => true }));

import { useCallStore, voiceRoom } from "./call_store";

afterEach(() => {
  api.ringDm.mockClear();
  useCallStore.setState({ incoming: null, active: null });
});

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
